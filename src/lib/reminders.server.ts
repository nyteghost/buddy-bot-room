import { currentUser } from "./accounts.server";
import { addReminder, afterFiring, dueReminders, parseRemindArgs, parseReminders, reminderList, removeReminder, repeatLabel, repeatName, snoozeReminder, snoozeTarget, type Reminder } from "./reminders";
import { pushNotice } from "./schedules.server";
import { validZone } from "./schedule";
import { whenLabel } from "./when";

const dir = () => (process.env["BUDDY_DATA_DIR"] ?? "").trim().replace(/\/+$/, "");
const fs = async () => (await import(/* @vite-ignore */ "node:" + "fs/promises")) as typeof import("node:fs/promises");
const file = () => `${dir()}/reminders.json`;
const tz = () => validZone(process.env["BUDDY_TZ"]) ?? validZone(Intl.DateTimeFormat().resolvedOptions().timeZone) ?? "UTC";

const lastFired: { current: Reminder | null } = { current: null };

let chain: Promise<unknown> = Promise.resolve();
const locked = <T,>(fn: () => Promise<T>): Promise<T> => { const run = chain.then(fn, fn); chain = run.catch(() => undefined); return run; };

export async function readReminders(): Promise<Reminder[]> {
  if (!dir()) return [];
  try { return parseReminders(JSON.parse(await (await fs()).readFile(file(), "utf8"))); } catch { return []; }
}
async function writeReminders(list: Reminder[]): Promise<void> {
  const f = await fs();
  await f.mkdir(dir(), { recursive: true });
  await f.writeFile(`${file()}.tmp`, JSON.stringify(list), { encoding: "utf8", mode: 0o600 });
  await f.rename(`${file()}.tmp`, file());
}

/** Read, change and save the reminder list as one step (used by the calendar-server sync so it can't race with firing). */
export async function updateReminders<T>(fn: (list: Reminder[]) => Promise<{ list: Reminder[]; result: T }>): Promise<T> {
  return locked(async () => {
    const { list, result } = await fn(await readReminders());
    await writeReminders(list);
    return result;
  });
}

/** Reminders that have fired and are waiting for you: shown as a pop-up while a page is open. Important ones keep nagging until Done. */
export type ActiveReminder = { id: string; text: string; notes?: string | undefined; repeat?: string | undefined; important: boolean; firedAt: number; nagAt: number; nags: number };
const NAG_EVERY_MS = 15 * 60_000;
const MAX_NAGS = 12;
const activeFile = () => `${dir()}/reminders-active.json`;
export async function readActive(): Promise<ActiveReminder[]> {
  if (!dir()) return [];
  try {
    const raw = JSON.parse(await (await fs()).readFile(activeFile(), "utf8")) as unknown;
    return Array.isArray(raw) ? (raw as ActiveReminder[]).filter((a) => a && typeof a.id === "string" && typeof a.text === "string").slice(0, 30) : [];
  } catch { return []; }
}
async function writeActive(list: ActiveReminder[]): Promise<void> {
  const f = await fs();
  await f.mkdir(dir(), { recursive: true });
  await f.writeFile(`${activeFile()}.tmp`, JSON.stringify(list), { encoding: "utf8", mode: 0o600 });
  await f.rename(`${activeFile()}.tmp`, activeFile());
}
const updateActive = <T,>(fn: (list: ActiveReminder[]) => { list: ActiveReminder[]; result: T }): Promise<T> => locked(async () => { const r = fn(await readActive()); await writeActive(r.list); return r.result; });

/** Called by the scheduler every tick: push whatever is due, then forget it (or move it on if it repeats). Important ones then re-alert until Done. */
export async function tickReminders(now = Date.now()): Promise<void> {
  await tickNags(now);
  const due = dueReminders(await readReminders(), now);
  if (!due.length) return;
  await locked(async () => { await writeReminders(afterFiring(await readReminders(), due, now, tz())); });
  await updateActive((list) => ({ list: [...list.filter((a) => !due.some((d) => d.id === a.id)), ...due.map((r): ActiveReminder => ({ id: r.id, text: r.text, notes: r.notes, repeat: r.repeat ? repeatName(r.repeat) : undefined, important: !!r.important, firedAt: now, nagAt: now + NAG_EVERY_MS, nags: 0 }))].slice(-30), result: 0 }));
  for (const r of due) {
    lastFired.current = r;
    const body = [r.text, r.notes ? `\n${r.notes}` : "", r.repeat ? `\nRepeats ${repeatName(r.repeat)}.` : "", r.important ? "\nImportant: I'll remind you again every 15 minutes until you mark it done in Pixel Pals." : '\nReply "snooze 30m" to be reminded again in a bit.'].join("");
    await pushNotice(r.important ? "IMPORTANT reminder" : "Reminder", body);
  }
}

/** Important reminders that haven't been marked done: push again every 15 minutes (up to 12 times). Others just stay on screen for an hour. */
async function tickNags(now: number): Promise<void> {
  const list = await readActive();
  if (!list.length) return;
  const nag = list.filter((a) => a.important && a.nagAt <= now && a.nags < MAX_NAGS);
  const keep = list.filter((a) => (a.important ? now - a.firedAt < 12 * 3_600_000 : now - a.firedAt < 3_600_000));
  if (!nag.length && keep.length === list.length) return;
  await updateActive((cur) => ({ list: cur.filter((a) => keep.some((k) => k.id === a.id && k.firedAt === a.firedAt)).map((a) => (nag.some((n) => n.id === a.id && n.firedAt === a.firedAt) ? { ...a, nags: a.nags + 1, nagAt: now + NAG_EVERY_MS } : a)), result: 0 }));
  for (const a of nag) await pushNotice("STILL WAITING: reminder", `${a.text}${a.notes ? `\n\n${a.notes}` : ""}\n\nOpen Pixel Pals and press Done to stop these.`).catch(() => undefined);
}

/** Reminders that fall on this calendar day (used by the morning brief). */
export async function remindersOnDay(day: string): Promise<string[]> {
  const z = tz();
  const key = (ms: number) => new Intl.DateTimeFormat("en-CA", { timeZone: z, year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date(ms));
  return (await readReminders()).filter((r) => key(r.at) === day).map((r) => `${new Intl.DateTimeFormat("en-US", { timeZone: z, hour: "numeric", minute: "2-digit" }).format(new Date(r.at))} ${r.text}`);
}

/** Add a reminder from plain text ("in 30m call mom"); returns what to tell the person. Used by chat, the Tasks window and Telegram. */
export async function createReminder(text: string, extra: { notes?: string; important?: boolean } = {}): Promise<string> {
  if (!dir()) return "Reminders need BUDDY_DATA_DIR (the data volume).";
  const p = parseRemindArgs(text, Date.now(), tz());
  if ("error" in p) return p.error;
  const added = addReminder(await readReminders(), p.at, p.text, crypto.randomUUID().slice(0, 8), p.repeat, { notes: extra.notes?.trim() || p.notes, important: extra.important || p.important });
  if (!added.ok) return added.error;
  await locked(() => writeReminders(added.list));
  const where = process.env["TELEGRAM_BOT_TOKEN"] ? "Telegram" : process.env["NTFY_URL"] ? "ntfy" : "";
  return `Okay, I'll remind you ${whenLabel(p.at, tz())}${p.repeat ? ` and then repeat ${repeatName(p.repeat)}` : ""}${extra.important || p.important ? " (important: I'll keep reminding you every 15 minutes until you mark it done)" : ""}: ${p.text}.${where ? "" : " Set NTFY_URL or TELEGRAM_BOT_TOKEN so it can reach your phone."}`;
}

/** Push the last reminder that fired (or one in the list) to a later time. Used by Telegram ("snooze 30m") and the Tasks window. */
export async function snooze(which: string, when: string): Promise<string> {
  const to = snoozeTarget(when, Date.now(), tz());
  if (to === null) return "I couldn't read that time. Try snooze 10m, snooze 1h or snooze tomorrow.";
  const list = await readReminders();
  if (!which) {
    const last = lastFired.current;
    if (!last) return "There's no recent reminder to snooze. Use /remind to set one.";
    const added = addReminder(list, to, last.text, crypto.randomUUID().slice(0, 8));
    if (!added.ok) return added.error;
    await locked(() => writeReminders(added.list));
    return `Snoozed until ${whenLabel(to, tz())}: ${last.text}`;
  }
  const r = snoozeReminder(list, which, to);
  if (!r.changed) return "No reminder with that number.";
  await locked(() => writeReminders(r.list));
  return `Snoozed until ${whenLabel(to, tz())}: ${r.changed.text}`;
}

/** POST { op: "list" | "add" | "remove", text?: string }. Owner only. */
export async function handleReminders(request: Request): Promise<Response> {
  const user = await currentUser(request);
  if (!user?.owner) return Response.json({ error: "Only the owner account can manage reminders." }, { status: 403 });
  if (!dir()) return Response.json({ error: "Reminders need BUDDY_DATA_DIR (the data volume)." }, { status: 503 });
  const body = (await request.json().catch(() => ({}))) as { op?: string; text?: string; notes?: string; important?: boolean; id?: string; when?: string };
  const text = typeof body.text === "string" ? body.text.slice(0, 400) : "";
  const list = await readReminders();
  const out = (t: string, l = list) => Response.json({ text: t, items: l.map((r) => ({ id: r.id, at: r.at, text: r.text, repeat: r.repeat, repeatName: r.repeat ? repeatName(r.repeat) : undefined, notes: r.notes, important: r.important })) });
  if (body.op === "alerts") return Response.json({ alerts: await readActive() });
  if (body.op === "done" || body.op === "snooze-alert") {
    const id = String(body.id ?? "");
    const hit = (await readActive()).find((a) => a.id === id);
    await updateActive((cur) => ({ list: cur.filter((a) => a.id !== id), result: 0 }));
    if (body.op === "snooze-alert" && hit) {
      const to = snoozeTarget(String(body.when ?? "30m"), Date.now(), tz());
      if (to === null) return out("I couldn't read that time.");
      const added = addReminder(await readReminders(), to, hit.text, crypto.randomUUID().slice(0, 8), undefined, { notes: hit.notes, important: hit.important });
      if (added.ok) await locked(() => writeReminders(added.list));
      return out(`Snoozed until ${whenLabel(to, tz())}: ${hit.text}`, await readReminders());
    }
    return out("Done.", await readReminders());
  }
  if (body.op === "add") {
    const reply = await createReminder(text, { notes: typeof body.notes === "string" ? body.notes.slice(0, 2000) : "", important: body.important === true });
    return out(reply, await readReminders());
  }
  if (body.op === "snooze") {
    const [which = "", ...rest] = text.trim().split(/\s+/);
    const reply = await snooze(which, rest.join(" "));
    return out(reply, await readReminders());
  }
  if (body.op === "remove") {
    const r = removeReminder(list, text.trim());
    if (!r.removed) return out("No reminder with that number. /remind list shows them.");
    await locked(() => writeReminders(r.list));
    return out(`Removed: ${r.removed.text.slice(0, 60)}`, r.list);
  }
  return out(reminderList(list, tz()));
}

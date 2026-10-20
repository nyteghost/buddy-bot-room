import { currentUser } from "./accounts.server";
import { addReminder, dueReminders, parseRemindArgs, parseReminders, reminderList, removeReminder, type Reminder } from "./reminders";
import { pushNotice } from "./schedules.server";
import { validZone } from "./schedule";
import { whenLabel } from "./when";

const dir = () => (process.env["BUDDY_DATA_DIR"] ?? "").trim().replace(/\/+$/, "");
const fs = async () => (await import(/* @vite-ignore */ "node:" + "fs/promises")) as typeof import("node:fs/promises");
const file = () => `${dir()}/reminders.json`;
const tz = () => validZone(process.env["BUDDY_TZ"]) ?? validZone(Intl.DateTimeFormat().resolvedOptions().timeZone) ?? "UTC";

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

/** Called by the scheduler every tick: push whatever is due, then forget it. */
export async function tickReminders(now = Date.now()): Promise<void> {
  const due = dueReminders(await readReminders(), now);
  if (!due.length) return;
  await locked(async () => { await writeReminders((await readReminders()).filter((r) => !due.some((d) => d.id === r.id))); });
  for (const r of due) await pushNotice("Reminder", r.text);
}

/** Reminders that fall on this calendar day (used by the morning brief). */
export async function remindersOnDay(day: string): Promise<string[]> {
  const z = tz();
  const key = (ms: number) => new Intl.DateTimeFormat("en-CA", { timeZone: z, year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date(ms));
  return (await readReminders()).filter((r) => key(r.at) === day).map((r) => `${new Intl.DateTimeFormat("en-US", { timeZone: z, hour: "numeric", minute: "2-digit" }).format(new Date(r.at))} ${r.text}`);
}

/** POST { op: "list" | "add" | "remove", text?: string }. Owner only. */
export async function handleReminders(request: Request): Promise<Response> {
  const user = await currentUser(request);
  if (!user?.owner) return Response.json({ error: "Only the owner account can manage reminders." }, { status: 403 });
  if (!dir()) return Response.json({ error: "Reminders need BUDDY_DATA_DIR (the data volume)." }, { status: 503 });
  const body = (await request.json().catch(() => ({}))) as { op?: string; text?: string };
  const text = typeof body.text === "string" ? body.text.slice(0, 400) : "";
  const list = await readReminders();
  const out = (t: string, l = list) => Response.json({ text: t, items: l.map((r) => ({ id: r.id, at: r.at, text: r.text })) });
  if (body.op === "add") {
    const p = parseRemindArgs(text, Date.now(), tz());
    if ("error" in p) return out(p.error);
    const added = addReminder(list, p.at, p.text, crypto.randomUUID().slice(0, 8));
    if (!added.ok) return out(added.error);
    await locked(() => writeReminders(added.list));
    const where = process.env["TELEGRAM_BOT_TOKEN"] ? "Telegram" : process.env["NTFY_URL"] ? "ntfy" : "";
    return out(`Okay, I'll remind you ${whenLabel(p.at, tz())}: ${p.text}.${where ? "" : " Set NTFY_URL or TELEGRAM_BOT_TOKEN so it can reach your phone."}`, added.list);
  }
  if (body.op === "remove") {
    const r = removeReminder(list, text.trim());
    if (!r.removed) return out("No reminder with that number. /remind list shows them.");
    await locked(() => writeReminders(r.list));
    return out(`Removed: ${r.removed.text.slice(0, 60)}`, r.list);
  }
  return out(reminderList(list, tz()));
}

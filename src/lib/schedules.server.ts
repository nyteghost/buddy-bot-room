import { currentUser } from "./accounts.server";
import { askPals } from "./ask.server";
import { telegramSend } from "./telegram.server";
import { logServer } from "./server-log.server";
import { jobs } from "./jobs.server";
import { addSchedule, parseScheduleArgs, parseSchedules, removeSchedule, scheduleDue, scheduleList, today, type Schedule } from "./schedules";
import { validZone } from "./schedule";

const dir = () => (process.env["BUDDY_DATA_DIR"] ?? "").trim().replace(/\/+$/, "");
const fs = async () => (await import(/* @vite-ignore */ "node:" + "fs/promises")) as typeof import("node:fs/promises");
const file = () => `${dir()}/schedules.json`;
const tz = () => validZone(process.env["BUDDY_TZ"]) ?? validZone(Intl.DateTimeFormat().resolvedOptions().timeZone) ?? "UTC";

let chain: Promise<unknown> = Promise.resolve();
const locked = <T,>(fn: () => Promise<T>): Promise<T> => { const run = chain.then(fn, fn); chain = run.catch(() => undefined); return run; };

export async function readSchedules(): Promise<Schedule[]> {
  if (!dir()) return [];
  try { return parseSchedules(JSON.parse(await (await fs()).readFile(file(), "utf8"))); } catch { return []; }
}
async function writeSchedules(list: Schedule[]): Promise<void> {
  const f = await fs();
  await f.mkdir(dir(), { recursive: true });
  await f.writeFile(`${file()}.tmp`, JSON.stringify(list), { encoding: "utf8", mode: 0o600 });
  await f.rename(`${file()}.tmp`, file());
}

export async function pushNotice(title: string, body: string): Promise<void> {
  const sent = await telegramSend(`${title}\n\n${body}`);
  const ntfy = (process.env["NTFY_URL"] ?? "").trim();
  if (ntfy.startsWith("http")) {
    try { await fetch(ntfy, { method: "POST", headers: { Title: title.replace(/[^\x20-\x7e]/g, "-").slice(0, 80), Tags: "robot" }, body: body.slice(0, 3500), signal: AbortSignal.timeout(8000) }); } catch { /* best effort */ }
  } else if (!sent) logServer("info", `Scheduled task finished but no NTFY_URL or Telegram is set: ${title}`);
}

/** Run one task now: ask the pals, send the answer, remember it. Only one run of a task at a time, and model work goes one at a time. */
export async function runSchedule(id: string, now = new Date()): Promise<string> {
  let text = "That task no longer exists.";
  const result = await jobs().run(`schedule:${id}`, async () => {
    const list = await readSchedules();
    const s = list.find((x) => x.id === id);
    if (!s) return;
    const r = await askPals(s.prompt);
    text = r.ok ? r.text : `Couldn't run: ${r.error}`;
    await locked(async () => {
      const fresh = await readSchedules();
      await writeSchedules(fresh.map((x) => (x.id === id ? { ...x, last: today(now, tz()), lastResult: text.slice(0, 600) } : x)));
    });
    await pushNotice(`Pixel Pals: ${s.prompt.slice(0, 40)}`, r.ok ? `${text}\n\n— ${r.via}` : text);
  }, { timeoutMs: 15 * 60_000, lane: "inference" });
  if (result === "skipped") return "That task is already running.";
  if (result === "timeout") return "That task took too long and was stopped.";
  if (result === "failed") return `Couldn't run: ${jobs().state(`schedule:${id}`)?.lastError ?? "error"}`;
  return text;
}

export async function tickSchedules(now = new Date()): Promise<void> {
  for (const s of await readSchedules()) {
    if (!scheduleDue(s, now, tz())) continue;
    // Mark first so a slow model can't trigger a second run on the next tick.
    await locked(async () => { await writeSchedules((await readSchedules()).map((x) => (x.id === s.id ? { ...x, last: today(now, tz()) } : x))); });
    await runSchedule(s.id, now).catch((e) => logServer("warn", `Scheduled task failed: ${e instanceof Error ? e.message : "error"}`));
  }
}

/** POST { op: "list" | "add" | "remove" | "run", text?: string }. Owner only, because tasks use the owner's keys. */
export async function handleSchedules(request: Request): Promise<Response> {
  const user = await currentUser(request);
  if (!user?.owner) return Response.json({ error: "Only the owner account can manage scheduled tasks." }, { status: 403 });
  if (!dir()) return Response.json({ error: "Scheduled tasks need BUDDY_DATA_DIR (the data volume)." }, { status: 503 });
  const body = (await request.json().catch(() => ({}))) as { op?: string; text?: string };
  const text = typeof body.text === "string" ? body.text.slice(0, 700) : "";
  const list = await readSchedules();
  if (body.op === "data") return Response.json({ schedules: list, tz: tz() });
  if (body.op === "add") {
    const p = parseScheduleArgs(text);
    if ("error" in p) return Response.json({ text: p.error });
    const added = addSchedule(list, p.time, p.days, p.prompt, crypto.randomUUID().slice(0, 8));
    if (!added.ok) return Response.json({ text: added.error });
    await locked(() => writeSchedules(added.list));
    return Response.json({ text: `Scheduled: ${p.time} ${p.days} (${tz()}). The answer goes to your phone via ${process.env["TELEGRAM_BOT_TOKEN"] ? "Telegram" : "ntfy"}${process.env["NTFY_URL"] || process.env["TELEGRAM_BOT_TOKEN"] ? "" : " once you set NTFY_URL or TELEGRAM_BOT_TOKEN"}. Only free keys and Local AI are used.` });
  }
  if (body.op === "remove") {
    const r = removeSchedule(list, text.trim());
    if (!r.removed) return Response.json({ text: "No task with that number. /schedule list shows them." });
    await locked(() => writeSchedules(r.list));
    return Response.json({ text: `Removed: ${r.removed.prompt.slice(0, 60)}` });
  }
  if (body.op === "run") {
    const target = Number.isInteger(Number(text)) ? list[Number(text) - 1] : list.find((x) => x.id === text.trim());
    if (!target) return Response.json({ text: "No task with that number." });
    return Response.json({ text: await runSchedule(target.id) });
  }
  return Response.json({ text: scheduleList(list) });
}

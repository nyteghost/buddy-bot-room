import { currentUser, tokenUser } from "./accounts.server";
import { askPals } from "./ask.server";
import { agents } from "./agents";
import { applyDump, addTask, dumpPrompt, extractJson, fallbackPick, markNudged, nudgesDue, parseCheckins, parseDump, parsePick, parseSmaller, parseState, pickPrompt, setStatus, setTier, smallerPrompt, openTasks, EMPTY, type Coach, type Tier, type TodayState } from "./today";
import { calendarData } from "./inbox.server";
import { pushNotice } from "./schedules.server";
import { validZone } from "./schedule";

const dir = () => (process.env["BUDDY_DATA_DIR"] ?? "").trim().replace(/\/+$/, "");
const fs = async () => (await import(/* @vite-ignore */ "node:" + "fs/promises")) as typeof import("node:fs/promises");
const file = () => `${dir()}/today.json`;
const tz = () => validZone(process.env["BUDDY_TZ"]) ?? validZone(Intl.DateTimeFormat().resolvedOptions().timeZone) ?? "UTC";
const newId = () => crypto.randomUUID().replace(/-/g, "").slice(0, 8);

let chain: Promise<unknown> = Promise.resolve();
const locked = <T,>(fn: () => Promise<T>): Promise<T> => { const run = chain.then(fn, fn); chain = run.catch(() => undefined); return run; };

async function read(): Promise<TodayState> {
  if (!dir()) return EMPTY;
  try { return parseState(JSON.parse(await (await fs()).readFile(file(), "utf8"))); } catch { return EMPTY; }
}
async function write(s: TodayState): Promise<void> {
  const f = await fs();
  await f.mkdir(dir(), { recursive: true });
  await f.writeFile(`${file()}.tmp`, JSON.stringify(s), { encoding: "utf8", mode: 0o600 });
  await f.rename(`${file()}.tmp`, file());
}
const update = (fn: (s: TodayState) => TodayState | Promise<TodayState>): Promise<TodayState> => locked(async () => { const next = await fn(await read()); await write(next); return next; });

const dayKey = (now: number) => new Intl.DateTimeFormat("en-CA", { timeZone: tz(), year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date(now));
const localMinutes = (now: number) => { const p = new Intl.DateTimeFormat("en-GB", { timeZone: tz(), hour: "2-digit", minute: "2-digit", hourCycle: "h23" }).formatToParts(new Date(now)); return +p.find((x) => x.type === "hour")!.value * 60 + +p.find((x) => x.type === "minute")!.value; };

const coachFor = (id: unknown): Coach | undefined => { const a = agents.find((x) => x.id === id); return a ? { name: a.name, role: a.role, tone: a.tone } : undefined; };

async function nextEvent(now: number): Promise<{ title: string; minutes: number } | null> {
  try {
    const cal = await calendarData(1);
    const e = cal.items.filter((x) => !x.allDay && x.start > now).sort((a, b) => a.start - b.start)[0];
    return e ? { title: e.title, minutes: Math.round((e.start - now) / 60_000) } : null;
  } catch { return null; }
}

async function ask(p: { system: string; prompt: string }, maxTokens = 900): Promise<{ json: unknown; error?: string }> {
  const r = await askPals(p.prompt, { system: p.system, maxTokens });
  if (!r.ok) return { json: null, error: r.error };
  return { json: extractJson(r.text), ...(extractJson(r.text) ? {} : { error: "The model didn't return a usable answer." }) };
}

const view = (s: TodayState) => ({ ...s, nudged: undefined, tasks: s.tasks.filter((t) => t.status === "open" || (t.doneAt ?? 0) > Date.now() - 36 * 3600_000) });

/** Add one item from the phone (Shortcut, Share sheet, Siri). Returns what to tell the person. */
export async function captureToday(text: string): Promise<string> {
  if (!dir()) return "Today needs BUDDY_DATA_DIR (the data volume).";
  const clean = text.replace(/\s+/g, " ").trim().slice(0, 200);
  if (!clean) return "Nothing to save.";
  await update((s) => addTask(s, clean, "capture", newId(), Date.now()));
  return `Added to Today: ${clean}`;
}

/** Token route for the iPhone Shortcut: POST { text } with Authorization: Bearer <access token>. Only adds. */
export async function handleTodayCapture(request: Request): Promise<Response> {
  const user = (await currentUser(request)) ?? (await tokenUser(request));
  if (!user?.owner) return Response.json({ error: "Only the owner account can capture." }, { status: 403 });
  const ct = request.headers.get("content-type") ?? "";
  const body = ct.includes("json") ? ((await request.json().catch(() => ({}))) as { text?: string }) : { text: await request.text().catch(() => "") };
  return Response.json({ text: await captureToday(String(body.text ?? "")) });
}

export async function handleToday(request: Request): Promise<Response> {
  const user = await currentUser(request);
  if (!user?.owner) return Response.json({ error: "Sign in as the owner to use Today." }, { status: 403 });
  if (!dir()) return Response.json({ error: "Today needs BUDDY_DATA_DIR (the data volume)." }, { status: 400 });
  const b = (await request.json().catch(() => ({}))) as Record<string, unknown>;
  const op = String(b["op"] ?? "get");
  const now = Date.now();
  const coach = coachFor(b["coach"]);
  const id = String(b["id"] ?? "");
  switch (op) {
    case "get": return Response.json({ state: view(await read()), today: dayKey(now) });
    case "add": return Response.json({ state: view(await update((s) => addTask(s, String(b["text"] ?? ""), "manual", newId(), now))) });
    case "done": case "drop": case "reopen": return Response.json({ state: view(await update((s) => setStatus(s, id, op === "done" ? "done" : op === "drop" ? "dropped" : "open", now))) });
    case "tier": { const t = ["must", "should", "could"].includes(String(b["tier"])) ? (b["tier"] as Tier) : null; return Response.json({ state: view(await update((s) => setTier(s, id, t))) }); }
    case "dump": {
      const text = String(b["text"] ?? "").slice(0, 6000).trim();
      if (!text) return Response.json({ error: "Type or dictate something first." }, { status: 400 });
      const pace = Math.min(5, Math.max(1, Math.round(Number(b["pace"]) || 3)));
      const mood = String(b["mood"] ?? "").slice(0, 200);
      const today = dayKey(now);
      const cur = await read();
      const r = await ask(dumpPrompt(text, pace, mood, openTasks(cur), today, coach), 1400);
      const parsed = r.json ? parseDump(r.json) : null;
      if (!parsed) {
        // No model answered: keep the words as tasks so nothing is lost.
        const lines = text.split(/\n|;|\. /).map((x) => x.trim()).filter(Boolean).slice(0, 30);
        const s = await update((st) => lines.reduce<TodayState>((acc, l) => addTask(acc, l, "dump", newId(), now), { ...st, day: { date: today, pace, mood, opening: "" } }));
        return Response.json({ state: view(s), warning: `${r.error ?? "No AI answered"} I saved your list as plain tasks; sort them by tapping a tier.` });
      }
      return Response.json({ state: view(await update((st) => applyDump(st, parsed, newId, now, { date: today, pace, mood }))) });
    }
    case "whatnow": {
      const exclude = id || null;
      const cur = await read();
      const ev = await nextEvent(now);
      let pick = null as ReturnType<typeof fallbackPick>;
      let warning = "";
      if (openTasks(cur).some((t) => t.id !== exclude)) {
        const r = await ask(pickPrompt(cur, new Date(now), ev, exclude, coach), 400);
        pick = r.json ? parsePick(r.json, cur, exclude) : null;
        if (!pick) { pick = fallbackPick(cur, exclude); if (r.error) warning = r.error; }
      }
      if (!pick) return Response.json({ state: view(cur), error: "Nothing open to pick from. Add something first." });
      const saved = { ...pick, at: now };
      return Response.json({ state: view(await update((s) => ({ ...s, pick: saved }))), ...(warning ? { warning } : {}) });
    }
    case "smaller": {
      const cur = await read();
      const t = cur.tasks.find((x) => x.id === id && x.status === "open");
      if (!t) return Response.json({ error: "That task is gone." }, { status: 404 });
      const r = await ask(smallerPrompt(t, coach), 300);
      const step = r.json ? parseSmaller(r.json) : null;
      if (!step) return Response.json({ error: r.error ?? "Couldn't shrink it. Try again." }, { status: 502 });
      const stepId = newId();
      const s = await update((st) => addTask(st, step.step, "smaller", stepId, now, { tier: t.tier ?? "should", size: "S", energy: "low", notes: step.why, parentId: id }));
      return Response.json({ state: view({ ...s, pick: { id: stepId, reason: step.why || "A tiny first step.", fallback: false, at: now } }), stepId });
    }
    default: return Response.json({ error: "Unknown request." }, { status: 400 });
  }
}

/** Scheduler tick: nudge before calendar events and at the check-in times, over your existing phone alerts. */
export async function tickToday(now = Date.now()): Promise<void> {
  if (!dir() || (process.env["TODAY_NUDGES"] ?? "").trim().toLowerCase() === "off") return;
  if (!(process.env["NTFY_URL"] ?? "").startsWith("http") && !process.env["TELEGRAM_BOT_TOKEN"]) return;
  const lead = Math.min(60, Math.max(1, Math.floor(Number(process.env["TODAY_NUDGE_LEAD"]) || 10)));
  const checkins = parseCheckins(process.env["TODAY_CHECKINS"] ?? "12:00, 15:30");
  const s = await read();
  const events = await calendarData(1).then((c) => c.items.map((e) => ({ title: e.title, start: e.start, allDay: e.allDay }))).catch(() => []);
  const due = nudgesDue({ now, localMinutes: localMinutes(now), dateKey: dayKey(now), events, leadMin: lead, checkins, s });
  if (!due.length) return;
  await update((st) => markNudged(st, due.map((n) => n.key)));
  for (const n of due) await pushNotice(n.title, n.body);
}

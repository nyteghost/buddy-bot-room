import { currentUser, tokenUser } from "./accounts.server";
import { askPals } from "./ask.server";
import { agents } from "./agents";
import { applyDump, addParsed, closeDay, extendFocus, startFocus, stopFocus, inAreaState, setArea, type Area, addRoutine, addTask, dueRoutines, dumpPrompt, extractJson, fallbackPick, fallbackWeek, keepTask, markNudged, nudgesDue, parseCheckins, parseDump, parsePick, parseSmaller, parseState, parseWeek, pickPrompt, removeRoutine, setStatus, setTier, setWhen, smallerPrompt, toggleWeek, weekPrompt, weekStartKey, weekStats, zonedEpoch, openTasks, EMPTY, type Coach, type Repeat, type Tier, type TodayState } from "./today";
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

async function nextEvent(now: number, s?: TodayState): Promise<{ title: string; minutes: number } | null> {
  const timed = (s ? openTasks(s) : []).filter((t) => t.at && t.at > now).map((t) => ({ title: t.title, start: t.at! }));
  const cal = await calendarData(1).then((c) => c.items.filter((x) => !x.allDay && x.start > now).map((x) => ({ title: x.title, start: x.start }))).catch(() => []);
  const e = [...cal, ...timed].sort((a, b) => a.start - b.start)[0];
  return e ? { title: e.title, minutes: Math.round((e.start - now) / 60_000) } : null;
}
const dowOf = (now: number) => new Date(`${dayKey(now)}T12:00:00Z`).getUTCDay();
/** Today's copy of each routine that is due, added once per day. */
const withRoutines = (s: TodayState, now: number) => dueRoutines(s, dayKey(now), dowOf(now), now, tz(), newId);
const weekStart = (now: number) => zonedEpoch(weekStartKey(dayKey(now)), 0, tz());
const agenda = (now: number) => calendarData(7).then((c) => ({ tz: tz(), configured: c.configured, events: c.items.filter((e) => e.end > now - 12 * 3600_000).slice(0, 150).map((e) => ({ title: e.title, start: e.start, end: e.end, allDay: e.allDay })) })).catch(() => ({ tz: tz(), configured: false, events: [] }));

async function ask(p: { system: string; prompt: string }, maxTokens = 900): Promise<{ json: unknown; error?: string }> {
  const r = await askPals(p.prompt, { system: p.system, maxTokens });
  if (!r.ok) return { json: null, error: r.error };
  return { json: extractJson(r.text), ...(extractJson(r.text) ? {} : { error: "The model didn't return a usable answer." }) };
}

const view = (s: TodayState) => ({ ...s, nudged: undefined, stats: weekStats(s, weekStart(Date.now())), tasks: s.tasks.filter((t) => t.status === "open" || (t.doneAt ?? 0) > Date.now() - 36 * 3600_000) });
const timeToMin = (v: unknown): number | null => { const m = /^(\d{1,2}):(\d{2})$/.exec(String(v ?? "")); return m && +m[1]! < 24 && +m[2]! < 60 ? +m[1]! * 60 + +m[2]! : null; };

/** Add one item from the phone (Shortcut, Share sheet, Siri). Returns what to tell the person. */
export async function captureToday(text: string): Promise<string> {
  if (!dir()) return "Today needs BUDDY_DATA_DIR (the data volume).";
  const clean = text.replace(/\s+/g, " ").trim().slice(0, 200);
  if (!clean) return "Nothing to save.";
  await update((s) => addParsed(s, clean, "capture", newId(), Date.now(), dayKey(Date.now()), tz()));
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

/** GET check for Shortcuts: says whether the server is reachable and the token is accepted. Adds nothing. */
export async function handleTodayCapturePing(request: Request): Promise<Response> {
  const user = (await currentUser(request)) ?? (await tokenUser(request));
  return Response.json({ ok: true, tokenAccepted: !!user?.owner });
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
    case "get": {
      let cur = await read();
      if (withRoutines(cur, now) !== cur) cur = await update((s) => withRoutines(s, now));
      return Response.json({ state: view(cur), today: dayKey(now), cal: await agenda(now) });
    }
    case "add": return Response.json({ state: view(await update((s) => addParsed(s, String(b["text"] ?? ""), "manual", newId(), now, dayKey(now), tz()))) });
    case "when": {
      const m = timeToMin(b["time"]);
      return Response.json({ state: view(await update((s) => { const t = s.tasks.find((x) => x.id === id); if (!t) return s; const dk = t.at ? new Intl.DateTimeFormat("en-CA", { timeZone: tz(), year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date(t.at)) : dayKey(now); return setWhen(s, id, m === null ? null : zonedEpoch(dk, m, tz())); })) });
    }
    case "area": { const v = b["area"] === "work" || b["area"] === "home" ? (b["area"] as Area) : null; return Response.json({ state: view(await update((s) => setArea(s, id, v))) }); }
    case "focus_start": return Response.json({ state: view(await update((s) => startFocus(s, id, Number(b["mins"]) || s.tasks.find((t) => t.id === id)?.mins || 25, now))) });
    case "focus_stop": return Response.json({ state: view(await update((s) => stopFocus(s))) });
    case "focus_more": return Response.json({ state: view(await update((s) => extendFocus(s, Number(b["mins"]) || 10))) });
    case "closeday": return Response.json({ state: view(await update((s) => closeDay(s, now))) });
    case "weekflag": return Response.json({ state: view(await update((s) => toggleWeek(s, id))) });
    case "keep": return Response.json({ state: view(await update((s) => keepTask(s, id, now))) });
    case "routine_add": {
      const repeat = (["daily", "weekdays", "weekly"].includes(String(b["repeat"])) ? b["repeat"] : "daily") as Repeat;
      const mins = Number(b["mins"]) > 0 ? Math.min(960, Math.round(Number(b["mins"]))) : null;
      const area = b["area"] === "work" || b["area"] === "home" ? (b["area"] as Area) : undefined;
      const next = await update((s) => withRoutines(addRoutine(s, { title: String(b["title"] ?? ""), repeat, dow: Math.round(Number(b["dow"]) || 0), time: timeToMin(b["time"]), mins, ...(area ? { area } : {}) }, newId()), now));
      return Response.json({ state: view(next) });
    }
    case "routine_del": return Response.json({ state: view(await update((s) => removeRoutine(s, id))) });
    case "weekplan": {
      const cur = await read();
      if (!openTasks(cur).length) return Response.json({ state: view(cur), error: "Nothing open to choose from yet." });
      const cal = await agenda(now);
      const dayName = (t: number) => new Intl.DateTimeFormat("en-US", { timeZone: tz(), weekday: "short", month: "short", day: "numeric" }).format(new Date(t));
      const r = await ask(weekPrompt(cur, cal.events.filter((e) => e.start >= now - 3600_000).slice(0, 60).map((e) => ({ title: e.title, day: dayName(e.start) })), dayKey(now), coach), 500);
      const parsed = r.json ? parseWeek(r.json, cur) : null;
      const ids = parsed?.ids ?? fallbackWeek(cur);
      const next = await update((s) => ({ ...s, tasks: s.tasks.map((t) => { const { week: _w, ...rest } = t; void _w; return t.status === "open" && ids.includes(t.id) ? { ...rest, week: true } : t.status === "open" ? rest : t; }) }));
      return Response.json({ state: view(next), weekNote: parsed?.note ?? "", ...(parsed ? {} : { warning: `${r.error ?? "No AI answered"} I picked by priority.` }), cal });
    }
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
      return Response.json({ state: view(await update((st) => applyDump(st, parsed, newId, now, { date: today, pace, mood }, tz()))) });
    }
    case "whatnow": {
      const exclude = id || null;
      const full = await read();
      const area = b["area"] === "work" || b["area"] === "home" ? (b["area"] as Area) : null;
      const cur = inAreaState(full, area);
      const lt = new Date(now).toLocaleString("en-US", { timeZone: tz(), weekday: "short", hour: "numeric", hourCycle: "h23" });
      const workHours = !area && /^(Mon|Tue|Wed|Thu|Fri)/.test(lt) && +(/(\d+)$/.exec(lt)?.[1] ?? 0) >= 7 && +(/(\d+)$/.exec(lt)?.[1] ?? 0) < 17;
      const hint = area ? `They are only looking at their ${area} tasks right now.` : workHours ? "It's their usual work hours, so lean toward work tasks unless something personal is urgent or has a time soon." : "";
      const ev = await nextEvent(now, cur);
      let pick = null as ReturnType<typeof fallbackPick>;
      let warning = "";
      if (openTasks(cur).some((t) => t.id !== exclude)) {
        const r = await ask(pickPrompt(cur, new Date(now), ev, exclude, coach, hint), 400);
        pick = r.json ? parsePick(r.json, cur, exclude) : null;
        if (!pick) { pick = fallbackPick(cur, exclude); if (r.error) warning = r.error; }
      }
      if (!pick) return Response.json({ state: view(full), error: "Nothing open to pick from. Add something first." });
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
  let s = await read();
  if (withRoutines(s, now) !== s) s = await update((st) => withRoutines(st, now));
  const events = await calendarData(1).then((c) => c.items.map((e) => ({ title: e.title, start: e.start, allDay: e.allDay }))).catch(() => []);
  const due = nudgesDue({ now, localMinutes: localMinutes(now), dateKey: dayKey(now), events, leadMin: lead, checkins, s });
  if (!due.length) return;
  await update((st) => markNudged(st, due.map((n) => n.key)));
  for (const n of due) await pushNotice(n.title, n.body);
}

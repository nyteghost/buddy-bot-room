// ADHD "Today" planner: pure logic (no I/O). Design follows the whatnow day planner: hold the day loosely in
// Must / Should / Could tiers, pick one thing for right now, and make big things smaller.
export type Tier = "must" | "should" | "could";
export const TIERS: Tier[] = ["must", "should", "could"];
export type Size = "S" | "M" | "L";
export type Energy = "low" | "med" | "high";
export type Status = "open" | "done" | "dropped";
export type Area = "work" | "home";
export const AREAS: Area[] = ["work", "home"];

export type TodayTask = {
  id: string; title: string; notes: string; tier: Tier | null; size: Size | null; energy: Energy | null; feeling: string;
  status: Status; source: "capture" | "dump" | "manual" | "smaller" | "routine"; createdAt: number; doneAt?: number; parentId?: string;
  /** Optional start time (epoch ms), rough length in minutes, and "this week" focus flag. */
  at?: number; mins?: number; week?: boolean; area?: Area;
};
export type Repeat = "daily" | "weekdays" | "weekly";
/** A thing that comes back by itself. `time` is minutes since midnight (local); `last` is the date it was last added. */
export type Routine = { id: string; title: string; repeat: Repeat; dow: number; time: number | null; mins: number | null; last: string; area: Area | null };
export type Pick = { id: string; reason: string; fallback: boolean; at: number };
export type TodayDay = { date: string; pace: number; mood: string; opening: string };
export type TodayState = { tasks: TodayTask[]; day: TodayDay | null; pick: Pick | null; nudged: string[]; routines: Routine[] };

export const PACE_LABELS = ["running on fumes", "gentle", "steady", "full steam", "go hard"] as const;
export const paceLabel = (p: number) => PACE_LABELS[Math.min(5, Math.max(1, Math.round(p))) - 1]!;
export const EMPTY: TodayState = { tasks: [], day: null, pick: null, nudged: [], routines: [] };

const clip = (v: unknown, n: number) => String(v ?? "").replace(/\s+/g, " ").trim().slice(0, n);
const oneOf = <T extends string>(v: unknown, list: readonly T[]): T | null => (list.includes(v as T) ? (v as T) : null);

export function parseTask(raw: unknown): TodayTask | null {
  const t = (raw ?? {}) as Record<string, unknown>;
  const title = clip(t["title"], 200);
  const id = clip(t["id"], 24);
  if (!title || !id) return null;
  const task: TodayTask = {
    id, title, notes: clip(t["notes"], 600), tier: oneOf(t["tier"], TIERS), size: oneOf(t["size"], ["S", "M", "L"] as const), energy: oneOf(t["energy"], ["low", "med", "high"] as const),
    feeling: clip(t["feeling"], 80), status: oneOf(t["status"], ["open", "done", "dropped"] as const) ?? "open",
    source: oneOf(t["source"], ["capture", "dump", "manual", "smaller", "routine"] as const) ?? "manual", createdAt: Number(t["createdAt"]) || 0,
  };
  if (Number(t["at"]) > 0) task.at = Number(t["at"]);
  if (Number(t["mins"]) > 0) task.mins = Math.min(960, Math.round(Number(t["mins"])));
  if (t["week"] === true) task.week = true;
  const area = oneOf(t["area"], AREAS);
  if (area) task.area = area;
  if (Number(t["doneAt"])) task.doneAt = Number(t["doneAt"]);
  if (t["parentId"]) task.parentId = clip(t["parentId"], 24);
  return task;
}

export function parseState(raw: unknown): TodayState {
  const r = (raw ?? {}) as Record<string, unknown>;
  const tasks = (Array.isArray(r["tasks"]) ? r["tasks"] : []).map(parseTask).filter((t): t is TodayTask => !!t).slice(-500);
  const d = r["day"] as Record<string, unknown> | null | undefined;
  const day = d && /^\d{4}-\d{2}-\d{2}$/.test(String(d["date"])) ? { date: String(d["date"]), pace: Math.min(5, Math.max(1, Math.round(Number(d["pace"]) || 3))), mood: clip(d["mood"], 200), opening: clip(d["opening"], 600) } : null;
  const p = r["pick"] as Record<string, unknown> | null | undefined;
  const pick = p && p["id"] ? { id: clip(p["id"], 24), reason: clip(p["reason"], 400), fallback: p["fallback"] === true, at: Number(p["at"]) || 0 } : null;
  const nudged = (Array.isArray(r["nudged"]) ? r["nudged"] : []).map((x) => clip(x, 60)).filter(Boolean).slice(-200);
  const routines = (Array.isArray(r["routines"]) ? r["routines"] : []).flatMap((x): Routine[] => {
    const q = (x ?? {}) as Record<string, unknown>;
    const title = clip(q["title"], 200), id = clip(q["id"], 24), repeat = oneOf(q["repeat"], ["daily", "weekdays", "weekly"] as const);
    if (!title || !id || !repeat) return [];
    const time = q["time"] === null || q["time"] === undefined || q["time"] === "" ? null : Math.min(1439, Math.max(0, Math.round(Number(q["time"]))));
    const mins = Number(q["mins"]) > 0 ? Math.min(960, Math.round(Number(q["mins"]))) : null;
    return [{ id, title, repeat, dow: Math.min(6, Math.max(0, Math.round(Number(q["dow"]) || 0))), time: Number.isFinite(time) ? time : null, mins, last: /^\d{4}-\d{2}-\d{2}$/.test(String(q["last"])) ? String(q["last"]) : "", area: oneOf(q["area"], AREAS) }];
  }).slice(0, 40);
  return { tasks, day, pick, nudged, routines };
}

export const openTasks = (s: TodayState) => s.tasks.filter((t) => t.status === "open");

export function addTask(s: TodayState, title: string, source: TodayTask["source"], id: string, now: number, extra: Partial<TodayTask> = {}): TodayState {
  const clean = clip(title, 200);
  if (!clean) return s;
  const dup = s.tasks.find((t) => t.status === "open" && t.title.toLowerCase() === clean.toLowerCase());
  if (dup) return s;
  return { ...s, tasks: [...s.tasks, { id, title: clean, notes: "", tier: null, size: null, energy: null, feeling: "", status: "open", source, createdAt: now, ...extra }] };
}

export function setStatus(s: TodayState, id: string, status: Status, now: number): TodayState {
  return { ...s, pick: s.pick?.id === id ? null : s.pick, tasks: s.tasks.map((t) => (t.id === id ? { ...t, status, ...(status === "done" ? { doneAt: now } : {}) } : t)) };
}
export function setTier(s: TodayState, id: string, tier: Tier | null): TodayState {
  return { ...s, tasks: s.tasks.map((t) => (t.id === id ? { ...t, tier } : t)) };
}

// ---------- work / home ----------
const WORK_WORDS = /\b(show|shows|crew|stage|schedule|engineer|ungerboeck|ballroom|hall|invoice|client|vendor|meeting|cobb|airwalls?|power order|work order|timesheet|pto|exhibitor|load[- ]?in|move[- ]?out|rigging)\b/i;
const HOME_WORDS = /\b(meds?|prescription|pharmacy|vet|dentist|doctor|groceries|laundry|dishes|cat|mom|dad|kids?|gym|dinner|birthday|rent|bills?)\b/i;
/** A best guess from the words alone; null when it isn't clear (the person can tag it with one tap). */
export function guessArea(title: string): Area | null {
  const w = WORK_WORDS.test(title), h = HOME_WORDS.test(title);
  return w && !h ? "work" : h && !w ? "home" : null;
}
/** Untagged items show under every filter, so nothing gets hidden. */
export const inArea = (t: TodayTask, area: Area | null) => !area || !t.area || t.area === area;
export const setArea = (s: TodayState, id: string, area: Area | null): TodayState => ({ ...s, tasks: s.tasks.map((t) => { if (t.id !== id) return t; const { area: _a, ...rest } = t; void _a; return area ? { ...rest, area } : rest; }) });
export const inAreaState = (s: TodayState, area: Area | null): TodayState => (area ? { ...s, tasks: s.tasks.filter((t) => inArea(t, area)) } : s);

// ---------- times ----------
const to24 = (h: number, ap: string | undefined): number | null => {
  if (h > 24) return null;
  const a = (ap ?? "").toLowerCase()[0];
  if (a === "p") return h === 12 ? 12 : (h % 12) + 12;
  if (a === "a") return h === 12 ? 0 : h % 12;
  if (h >= 13) return h % 24;
  if (h === 12) return 12;
  return h >= 1 && h <= 7 ? h + 12 : h; // "at 3" means 3pm; "at 9" means 9am
};

/** Pulls a time of day ("at 3pm", "14:30", "@9") and a length ("for 30 min") out of a quick-capture line. */
export function parseWhen(text: string): { title: string; minutes: number | null; mins: number | null } {
  let t = ` ${text.replace(/\s+/g, " ").trim()} `;
  let minutes: number | null = null, mins: number | null = null;
  const len = /\bfor (?:(an?|\d{1,3}(?:\.\d)?)\s*(hours?|hrs?|h|minutes?|mins?|m)\b)/i.exec(t);
  if (len) {
    const n = /^an?$/i.test(len[1]!) ? 1 : Number(len[1]);
    mins = Math.round(/^h/i.test(len[2]!) ? n * 60 : n);
    t = t.replace(len[0], " ");
  }
  const pat = [
    /(?:\bat|@)\s*(\d{1,2})(?::(\d{2}))?\s*(am|pm|a\.m\.|p\.m\.)?(?=\s|$|[.,!?])/i,
    /\b(\d{1,2}):(\d{2})\s*(am|pm|a\.m\.|p\.m\.)?(?=\s|$|[.,!?])/i,
    /\b(\d{1,2})\s*(am|pm|a\.m\.|p\.m\.)(?=\s|$|[.,!?])/i,
  ];
  for (let i = 0; i < pat.length && minutes === null; i++) {
    const r = pat[i]!.exec(t);
    if (!r) continue;
    const h = Number(r[1]);
    const mm = i === 2 ? 0 : r[2] ? Number(r[2]) : 0;
    const ap = i === 2 ? r[2] : r[3];
    if (mm > 59) continue;
    const h24 = to24(h, ap);
    if (h24 === null || h24 > 23) continue;
    minutes = h24 * 60 + mm;
    t = t.replace(r[0], " ");
  }
  const title = t.replace(/\s+/g, " ").replace(/\s+(at|@|by|for)\s*$/i, "").trim().replace(/^[\s,.-]+|[\s,.-]+$/g, "");
  return { title: title || text.trim(), minutes, mins };
}

/** Epoch ms for a local clock time on a local date in `zone`. */
export function zonedEpoch(dateKey: string, minutes: number, zone: string): number {
  const [y, mo, d] = dateKey.split("-").map(Number) as [number, number, number];
  const guess = Date.UTC(y, mo - 1, d, 0, minutes);
  const offset = (at: number) => {
    const p = new Intl.DateTimeFormat("en-US", { timeZone: zone, hourCycle: "h23", year: "numeric", month: "numeric", day: "numeric", hour: "numeric", minute: "numeric", second: "numeric" }).formatToParts(new Date(at));
    const g = (k: string) => Number(p.find((x) => x.type === k)!.value);
    return Date.UTC(g("year"), g("month") - 1, g("day"), g("hour"), g("minute"), g("second")) - at;
  };
  const first = guess - offset(guess);
  return guess - offset(first);
}
export const clockLabel = (at: number, zone: string) => new Intl.DateTimeFormat("en-US", { timeZone: zone, hour: "numeric", minute: "2-digit" }).format(new Date(at));

/** Adds a quick-capture line, reading a time and length out of the words. A time already well past today means tomorrow. */
export function addParsed(s: TodayState, text: string, source: TodayTask["source"], id: string, now: number, dateKey: string, zone: string): TodayState {
  const w = parseWhen(text);
  const extra: Partial<TodayTask> = {};
  if (w.mins) extra.mins = w.mins;
  if (w.minutes !== null) {
    let at = zonedEpoch(dateKey, w.minutes, zone);
    if (at < now - 30 * 60_000) at += 24 * 3600_000;
    extra.at = at;
  }
  const area = guessArea(w.title);
  if (area) extra.area = area;
  return addTask(s, w.title, source, id, now, extra);
}
export const setWhen = (s: TodayState, id: string, at: number | null): TodayState => ({ ...s, tasks: s.tasks.map((t) => { if (t.id !== id) return t; const { at: _a, ...rest } = t; void _a; return at ? { ...rest, at } : rest; }) });
export const toggleWeek = (s: TodayState, id: string, on?: boolean): TodayState => ({ ...s, tasks: s.tasks.map((t) => { if (t.id !== id) return t; const { week: _w, ...rest } = t; void _w; return (on ?? !t.week) ? { ...rest, week: true } : rest; }) });
/** "Still want this?": restart the clock on an old item so it stops showing as stale. */
export const keepTask = (s: TodayState, id: string, now: number): TodayState => ({ ...s, tasks: s.tasks.map((t) => (t.id === id ? { ...t, createdAt: now } : t)) });

// ---------- routines ----------
const applies = (r: Routine, dow: number) => r.repeat === "daily" || (r.repeat === "weekdays" && dow >= 1 && dow <= 5) || (r.repeat === "weekly" && dow === r.dow);
/** Adds today's copy of each routine that is due and hasn't been added yet today. */
export function dueRoutines(s: TodayState, dateKey: string, dow: number, now: number, zone: string, ids: () => string): TodayState {
  const due = s.routines.filter((r) => r.last !== dateKey && applies(r, dow));
  if (!due.length) return s;
  let next = { ...s, routines: s.routines.map((r) => (due.includes(r) ? { ...r, last: dateKey } : r)) };
  for (const r of due) next = addTask(next, r.title, "routine", ids(), now, { ...(r.time !== null ? { at: zonedEpoch(dateKey, r.time, zone) } : {}), ...(r.mins ? { mins: r.mins } : {}), ...(r.area ? { area: r.area } : {}) });
  return next;
}
export function addRoutine(s: TodayState, r: Omit<Routine, "id" | "last" | "area"> & { area?: Area | null }, id: string): TodayState {
  const title = clip(r.title, 200);
  if (!title) return s;
  return { ...s, routines: [...s.routines, { id, title, repeat: r.repeat, dow: Math.min(6, Math.max(0, r.dow)), time: r.time, mins: r.mins, last: "", area: r.area ?? guessArea(title) }].slice(0, 40) };
}
export const removeRoutine = (s: TodayState, id: string): TodayState => ({ ...s, routines: s.routines.filter((r) => r.id !== id) });

/** End of day: clears the "do this now" pick and any times that already passed, so tomorrow doesn't open with yesterday's clock. */
export function closeDay(s: TodayState, now: number): TodayState {
  return { ...s, pick: null, tasks: s.tasks.map((t) => { if (t.status !== "open" || !t.at || t.at >= now) return t; const { at: _a, ...rest } = t; void _a; return rest; }) };
}

// ---------- the week ----------
const mondayOf = (dateKey: string) => { const d = new Date(`${dateKey}T12:00:00Z`); const dow = (d.getUTCDay() + 6) % 7; return d.getTime() - dow * 86400_000; };
/** Counts for the Friday wrap-up. `weekStart` is the epoch ms of Monday 00:00 local. */
export function weekStats(s: TodayState, weekStart: number): { doneWeek: number; open: number; stale: string[] } {
  const stale = s.tasks.filter((t) => t.status === "open" && !t.at && t.source !== "routine" && t.createdAt > 0 && t.createdAt < Date.now() - 7 * 86400_000).map((t) => t.id);
  return { doneWeek: s.tasks.filter((t) => t.status === "done" && (t.doneAt ?? 0) >= weekStart).length, open: openTasks(s).length, stale };
}
export const weekStartKey = (dateKey: string) => new Date(mondayOf(dateKey)).toISOString().slice(0, 10);

export function weekPrompt(s: TodayState, events: { title: string; day: string }[], today: string, coach?: Coach): { system: string; prompt: string } {
  const lines = openTasks(s).map((t) => `#${t.id} ${t.title}${t.tier ? ` [${t.tier}]` : ""}${t.at ? " (has a time)" : ""}`).join("\n") || "(none)";
  return {
    system: `${persona(coach)}\n\nIt's time to look ahead at the week. Pick the two or three things that matter most this week from their open tasks, things that would make the week feel handled if they got done. Reply ONLY with JSON: {"focus": [string], "note": string}. focus: task ids, at most 3. note: two kind sentences about the shape of the week, using the calendar. Don't schedule hours.`,
    prompt: `Today is ${today}.\n\nCalendar this week:\n${events.map((e) => `${e.day}: ${e.title}`).join("\n") || "(nothing)"}\n\nOpen tasks:\n${lines}`,
  };
}
export function parseWeek(raw: unknown, s: TodayState): { ids: string[]; note: string } | null {
  const r = raw as { focus?: unknown; note?: unknown } | null;
  if (!r || !Array.isArray(r.focus)) return null;
  const open = new Set(openTasks(s).map((t) => t.id));
  const ids = r.focus.map((x) => String(x).replace(/^#/, "")).filter((x) => open.has(x)).slice(0, 3);
  return ids.length ? { ids, note: clip(r.note, 500) } : null;
}
export const fallbackWeek = (s: TodayState): string[] => {
  const rank = (t: TodayTask) => (t.tier === "must" ? 0 : t.tier === "should" ? 1 : t.tier === "could" ? 2 : 3);
  return openTasks(s).filter((t) => !t.at).sort((a, b) => rank(a) - rank(b) || a.createdAt - b.createdAt).slice(0, 3).map((t) => t.id);
};

/** Pulls the first JSON object out of a model reply (models often wrap it in prose or code fences). */
export function extractJson(text: string): unknown {
  const t = text.replace(/```(?:json)?/gi, "");
  const start = t.indexOf("{");
  if (start < 0) return null;
  let depth = 0, inStr = false, esc = false;
  for (let i = start; i < t.length; i++) {
    const c = t[i]!;
    if (inStr) { if (esc) esc = false; else if (c === "\\") esc = true; else if (c === '"') inStr = false; continue; }
    if (c === '"') inStr = true;
    else if (c === "{") depth++;
    else if (c === "}" && --depth === 0) { try { return JSON.parse(t.slice(start, i + 1)); } catch { return null; } }
  }
  return null;
}

export type Coach = { name: string; role: string; tone: string };
const persona = (c?: Coach) => `You help someone with ADHD get through their day. You hold the day loosely, not as an hourly schedule: what they must do, what they should do, and what they could do if there's room. You're warm and direct and you pay attention to how they feel about their work.${c ? ` Speak as ${c.name}, ${c.role.toLowerCase()}: ${c.tone}` : ""}`;

export function dumpPrompt(text: string, pace: number, mood: string, open: TodayTask[], today: string, coach?: Coach): { system: string; prompt: string } {
  const have = open.map((t) => `#${t.id} ${t.title}${t.tier ? ` [${t.tier}]` : ""}`).join("\n") || "(none)";
  return {
    system: `${persona(coach)}\n\nSomeone just dumped everything on their mind. Turn it into clean tasks and sort them. Reply ONLY with JSON: {"opening": string, "tasks": [{"title": string, "notes": string, "tier": "must"|"should"|"could", "size": "S"|"M"|"L"|"", "energy": "low"|"med"|"high"|"", "feeling": string, "time": string, "minutes": number, "area": "work"|"home"|""}]}.\n- must: it really has to happen today. should: it matters and today is a good day. could: worth doing if there's room.\n- Fit the plan to their pace. At a low pace keep must very short. At a high pace plan more.\n- title: short and concrete, in their words. One task per thing; split run-on items.\n- size: S under 30 minutes, M a few hours, L most of a day. energy: the mental effort. feeling: how they feel about it, only if they said. Never invent feelings.\n- time: "HH:MM" in 24-hour time ONLY if they gave a clock time for it ("dentist at 3" is "15:00"); otherwise "". minutes: how long it will take if they said, else 0.
- area: "work" for their job, "home" for personal and household things, "" if you can't tell.
- Don't repeat anything already on their list; leave it out.\n- opening: two or three kind sentences in your voice. Don't list the tasks.`,
    prompt: `Today is ${today}. Pace: ${pace}/5 (${paceLabel(pace)}).${mood ? ` How I feel: ${mood}.` : ""}\n\nAlready on my list:\n${have}\n\nMy brain dump:\n${text}`,
  };
}

export type DumpResult = { opening: string; tasks: { title: string; notes: string; tier: Tier; size: Size | null; energy: Energy | null; feeling: string; time: number | null; minutes: number | null; area: Area | null }[] };
export function parseDump(raw: unknown): DumpResult | null {
  const r = raw as { opening?: unknown; tasks?: unknown } | null;
  if (!r || !Array.isArray(r.tasks)) return null;
  const tasks = r.tasks.flatMap((x) => {
    const t = (x ?? {}) as Record<string, unknown>;
    const title = clip(t["title"], 200);
    if (!title) return [];
    return [{ title, notes: clip(t["notes"], 600), tier: oneOf(t["tier"], TIERS) ?? "could", size: oneOf(t["size"], ["S", "M", "L"] as const), energy: oneOf(t["energy"], ["low", "med", "high"] as const), feeling: clip(t["feeling"], 80), time: (() => { const m = /^(\d{1,2}):(\d{2})$/.exec(String(t["time"] ?? "")); return m && +m[1]! < 24 && +m[2]! < 60 ? +m[1]! * 60 + +m[2]! : null; })(), minutes: Number(t["minutes"]) > 0 ? Math.min(960, Math.round(Number(t["minutes"]))) : null, area: oneOf(t["area"], AREAS) ?? guessArea(title) }];
  }).slice(0, 40);
  return { opening: clip(r.opening, 600), tasks };
}

export function applyDump(s: TodayState, d: DumpResult, ids: () => string, now: number, day: Omit<TodayDay, "opening">, zone = "UTC"): TodayState {
  let next: TodayState = { ...s, day: { ...day, opening: d.opening } };
  for (const t of d.tasks) {
    const before = next.tasks.length;
    next = addTask(next, t.title, "dump", ids(), now, { notes: t.notes, tier: t.tier, size: t.size, energy: t.energy, feeling: t.feeling, ...(t.time !== null ? { at: ((a) => (a < now - 30 * 60_000 ? a + 24 * 3600_000 : a))(zonedEpoch(day.date, t.time, zone)) } : {}), ...(t.minutes ? { mins: t.minutes } : {}), ...(t.area ? { area: t.area } : {}) });
    void before;
  }
  return next;
}

/** Local fallback when no model is available: sort by tier, then oldest. */
export function fallbackPick(s: TodayState, exclude: string | null): Pick | null {
  const rank = (t: TodayTask) => (t.tier === "must" ? 0 : t.tier === "should" ? 1 : t.tier === "could" ? 2 : 3);
  const best = openTasks(s).filter((t) => t.id !== exclude).sort((a, b) => rank(a) - rank(b) || a.createdAt - b.createdAt)[0];
  return best ? { id: best.id, reason: "Next up from your list (no AI answered, so I picked by priority).", fallback: true, at: 0 } : null;
}

export function pickPrompt(s: TodayState, now: Date, nextEvent: { title: string; minutes: number } | null, exclude: string | null, coach?: Coach, hint = ""): { system: string; prompt: string } {
  const lines = openTasks(s).filter((t) => t.id !== exclude).map((t) => `#${t.id} ${t.title}${t.tier ? ` [${t.tier}]` : " [unplanned]"}${t.size ? ` size ${t.size}` : ""}${t.energy ? ` energy ${t.energy}` : ""}${t.feeling ? ` feels: ${t.feeling}` : ""}${t.area ? ` (${t.area})` : ""}`).join("\n");
  return {
    system: `${persona(coach)}${hint ? `\n\n${hint}` : ""}\n\nThey asked "what now?". Pick the ONE task they should start right now from their open tasks. Reply ONLY with JSON: {"task_id": string, "reason": string}.\n- Weigh the tiers, the free time before their next event, their pace and how they feel. A short gap before a meeting suits a small task. A low pace or rough mood suits something lighter.\n- reason: one or two sentences, to them, concrete and kind.`,
    prompt: `It's ${now.toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit" })}. Pace: ${s.day ? `${s.day.pace}/5 (${paceLabel(s.day.pace)})` : "not set"}.${s.day?.mood ? ` Mood: ${s.day.mood}.` : ""}${nextEvent ? ` Next event: ${nextEvent.title} in ${nextEvent.minutes} minutes.` : " Nothing is scheduled soon."}${exclude ? ` I just passed on #${exclude}.` : ""}\n\nOpen tasks:\n${lines}`,
  };
}
export function parsePick(raw: unknown, s: TodayState, exclude: string | null): Pick | null {
  const r = raw as { task_id?: unknown; reason?: unknown } | null;
  const id = String(r?.task_id ?? "").replace(/^#/, "");
  const t = openTasks(s).find((x) => x.id === id && x.id !== exclude);
  return t ? { id: t.id, reason: clip(r?.reason, 400) || "This looks like the right next step.", fallback: false, at: 0 } : null;
}

export function smallerPrompt(t: TodayTask, coach?: Coach): { system: string; prompt: string } {
  return {
    system: `${persona(coach)}\n\nThey're dreading or stuck on a task. Find its tiny first step: something they can start in under five minutes with almost no effort, concrete enough to just do. Reply ONLY with JSON: {"step": string, "why": string}. step: one short imperative sentence. why: one kind sentence.`,
    prompt: `Task: ${t.title}${t.notes ? `\nNotes: ${t.notes}` : ""}${t.feeling ? `\nHow I feel about it: ${t.feeling}` : ""}`,
  };
}
export function parseSmaller(raw: unknown): { step: string; why: string } | null {
  const r = raw as { step?: unknown; why?: unknown } | null;
  const step = clip(r?.step, 200);
  return step ? { step, why: clip(r?.why, 300) } : null;
}

// ---------- nudges ----------
export type NudgeEvent = { title: string; start: number; allDay: boolean };
export type Nudge = { key: string; title: string; body: string };

/** What to push now. `leadMin` before a timed event; check-ins at the given HH:MM times (local, passed as minutes since midnight). */
export function nudgesDue(opts: { now: number; localMinutes: number; dateKey: string; events: NudgeEvent[]; leadMin: number; checkins: number[]; s: TodayState }): Nudge[] {
  const out: Nudge[] = [];
  const done = new Set(opts.s.nudged);
  for (const e of opts.events) {
    if (e.allDay) continue;
    const mins = (e.start - opts.now) / 60_000;
    const key = `ev:${e.start}:${e.title.slice(0, 20)}`;
    if (mins > 0 && mins <= opts.leadMin && !done.has(key)) out.push({ key, title: `${e.title} in ${Math.ceil(mins)} min`, body: "Wrap up what you're doing. Open Today and tap What now? if you need a small thing before it." });
  }
  for (const t of openTasks(opts.s)) {
    if (!t.at) continue;
    const mins = (t.at - opts.now) / 60_000;
    const key = `tk:${t.id}:${t.at}`;
    if (mins > 0 && mins <= opts.leadMin && !done.has(key)) out.push({ key, title: `${t.title} in ${Math.ceil(mins)} min`, body: t.mins ? `About ${t.mins} min. Start winding down what you're on.` : "Start winding down what you're on." });
  }
  for (const c of opts.checkins) {
    const key = `ci:${opts.dateKey}:${c}`;
    if (opts.localMinutes >= c && opts.localMinutes < c + 30 && !done.has(key)) {
      const open = openTasks(opts.s);
      const must = open.filter((t) => t.tier === "must").length;
      out.push({ key, title: "Check-in", body: open.length ? `${open.length} open${must ? `, ${must} must` : ""}. Tap What now? for one next step.` : "Nothing open. Anything on your mind? Capture it before it's gone." });
    }
  }
  return out;
}
export const markNudged = (s: TodayState, keys: string[]): TodayState => ({ ...s, nudged: [...s.nudged, ...keys].slice(-200) });

/** "HH:MM, HH:MM" -> minutes since midnight. */
export function parseCheckins(text: string): number[] {
  return text.split(/[\s,]+/).flatMap((p) => { const m = /^(\d{1,2}):(\d{2})$/.exec(p); return m && +m[1]! < 24 && +m[2]! < 60 ? [+m[1]! * 60 + +m[2]!] : []; });
}

// ADHD "Today" planner: pure logic (no I/O). Design follows the whatnow day planner: hold the day loosely in
// Must / Should / Could tiers, pick one thing for right now, and make big things smaller.
export type Tier = "must" | "should" | "could";
export const TIERS: Tier[] = ["must", "should", "could"];
export type Size = "S" | "M" | "L";
export type Energy = "low" | "med" | "high";
export type Status = "open" | "done" | "dropped";

export type TodayTask = {
  id: string; title: string; notes: string; tier: Tier | null; size: Size | null; energy: Energy | null; feeling: string;
  status: Status; source: "capture" | "dump" | "manual" | "smaller"; createdAt: number; doneAt?: number; parentId?: string;
};
export type Pick = { id: string; reason: string; fallback: boolean; at: number };
export type TodayDay = { date: string; pace: number; mood: string; opening: string };
export type TodayState = { tasks: TodayTask[]; day: TodayDay | null; pick: Pick | null; nudged: string[] };

export const PACE_LABELS = ["running on fumes", "gentle", "steady", "full steam", "go hard"] as const;
export const paceLabel = (p: number) => PACE_LABELS[Math.min(5, Math.max(1, Math.round(p))) - 1]!;
export const EMPTY: TodayState = { tasks: [], day: null, pick: null, nudged: [] };

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
    source: oneOf(t["source"], ["capture", "dump", "manual", "smaller"] as const) ?? "manual", createdAt: Number(t["createdAt"]) || 0,
  };
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
  return { tasks, day, pick, nudged };
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
    system: `${persona(coach)}\n\nSomeone just dumped everything on their mind. Turn it into clean tasks and sort them. Reply ONLY with JSON: {"opening": string, "tasks": [{"title": string, "notes": string, "tier": "must"|"should"|"could", "size": "S"|"M"|"L"|"", "energy": "low"|"med"|"high"|"", "feeling": string}]}.\n- must: it really has to happen today. should: it matters and today is a good day. could: worth doing if there's room.\n- Fit the plan to their pace. At a low pace keep must very short. At a high pace plan more.\n- title: short and concrete, in their words. One task per thing; split run-on items.\n- size: S under 30 minutes, M a few hours, L most of a day. energy: the mental effort. feeling: how they feel about it, only if they said. Never invent feelings.\n- Don't repeat anything already on their list; leave it out.\n- opening: two or three kind sentences in your voice. Don't list the tasks.`,
    prompt: `Today is ${today}. Pace: ${pace}/5 (${paceLabel(pace)}).${mood ? ` How I feel: ${mood}.` : ""}\n\nAlready on my list:\n${have}\n\nMy brain dump:\n${text}`,
  };
}

export type DumpResult = { opening: string; tasks: { title: string; notes: string; tier: Tier; size: Size | null; energy: Energy | null; feeling: string }[] };
export function parseDump(raw: unknown): DumpResult | null {
  const r = raw as { opening?: unknown; tasks?: unknown } | null;
  if (!r || !Array.isArray(r.tasks)) return null;
  const tasks = r.tasks.flatMap((x) => {
    const t = (x ?? {}) as Record<string, unknown>;
    const title = clip(t["title"], 200);
    if (!title) return [];
    return [{ title, notes: clip(t["notes"], 600), tier: oneOf(t["tier"], TIERS) ?? "could", size: oneOf(t["size"], ["S", "M", "L"] as const), energy: oneOf(t["energy"], ["low", "med", "high"] as const), feeling: clip(t["feeling"], 80) }];
  }).slice(0, 40);
  return { opening: clip(r.opening, 600), tasks };
}

export function applyDump(s: TodayState, d: DumpResult, ids: () => string, now: number, day: Omit<TodayDay, "opening">): TodayState {
  let next: TodayState = { ...s, day: { ...day, opening: d.opening } };
  for (const t of d.tasks) {
    const before = next.tasks.length;
    next = addTask(next, t.title, "dump", ids(), now, { notes: t.notes, tier: t.tier, size: t.size, energy: t.energy, feeling: t.feeling });
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

export function pickPrompt(s: TodayState, now: Date, nextEvent: { title: string; minutes: number } | null, exclude: string | null, coach?: Coach): { system: string; prompt: string } {
  const lines = openTasks(s).filter((t) => t.id !== exclude).map((t) => `#${t.id} ${t.title}${t.tier ? ` [${t.tier}]` : " [unplanned]"}${t.size ? ` size ${t.size}` : ""}${t.energy ? ` energy ${t.energy}` : ""}${t.feeling ? ` feels: ${t.feeling}` : ""}`).join("\n");
  return {
    system: `${persona(coach)}\n\nThey asked "what now?". Pick the ONE task they should start right now from their open tasks. Reply ONLY with JSON: {"task_id": string, "reason": string}.\n- Weigh the tiers, the free time before their next event, their pace and how they feel. A short gap before a meeting suits a small task. A low pace or rough mood suits something lighter.\n- reason: one or two sentences, to them, concrete and kind.`,
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

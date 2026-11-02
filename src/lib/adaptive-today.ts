import { agents, type AgentId } from "./agents";
import { scrubChatText } from "./chat-scrub";
import { readFocusCheckpoint, type FocusSession } from "./focus-companion";
import { fallbackStartStep } from "./focus-assist";
import { zoneDateKey } from "./day-overview";
import type { TodayTask } from "./today";
export const TODAY_SECTIONS = [
  ["focus", "Focus Assist"],
  ["calendar", "Calendar"],
  ["tasks", "My Tasks"],
  ["memory", "Memory and Resume"],
  ["parking", "Distraction Parking Lot"],
  ["brain-dump", "Brain Dump"],
  ["weather", "Weather"],
  ["mail", "Pal Mailbox"],
  ["tonight", "Tonight"],
  ["watch-queue", "Watch queue"],
] as const;
export type TodaySectionId = (typeof TODAY_SECTIONS)[number][0];
export type SectionPreference = { id: TodaySectionId; hidden: boolean; collapsed: boolean };
export type DayMode = "low" | "normal" | "focused";
export type Checkpoint = {
  id: string;
  revision: number;
  updated: number;
  project: string;
  state: string;
  decisions: string;
  blockers: string;
  sources: string;
  session: FocusSession;
  history: Omit<Checkpoint, "history">[];
};
export type AdaptiveToday = {
  version: 1;
  revision: number;
  mode: DayMode;
  favorite: AgentId;
  timeAware: boolean;
  sections: SectionPreference[];
  checkpoints: Checkpoint[];
};
export const adaptiveDefaults = (): AdaptiveToday => ({
  version: 1,
  revision: 0,
  mode: "normal",
  favorite: "byte",
  timeAware: false,
  sections: TODAY_SECTIONS.map(([id]) => ({
    id,
    hidden: false,
    collapsed: id === "memory" || id === "parking",
  })),
  checkpoints: [],
});
export const adaptiveId = (id: unknown): id is string =>
  typeof id === "string" && /^[a-zA-Z0-9_-]{1,80}$/.test(id);
export const compactText = (value: unknown, max = 600) =>
  typeof value === "string" ? scrubChatText(value).trim().slice(0, max) : "";
export function cleanSession(value: unknown): FocusSession | null {
  if (!value || typeof value !== "object") return null;
  const session = readFocusCheckpoint(JSON.stringify(value));
  return session
    ? {
        ...session,
        task: compactText(session.task, 280),
        step: compactText(session.step, 180),
        completed: session.completed.map((s) => compactText(s, 180)),
      }
    : null;
}
function checkpoint(value: unknown): Checkpoint | null {
  if (!value || typeof value !== "object") return null;
  const v = value as Checkpoint,
    session = cleanSession(v.session);
  if (
    !adaptiveId(v.id) ||
    !session ||
    !Number.isSafeInteger(v.revision) ||
    v.revision < 1 ||
    !Number.isFinite(v.updated)
  )
    return null;
  return {
    id: v.id,
    revision: v.revision,
    updated: v.updated,
    session,
    project: adaptiveId(v.project) ? v.project : "",
    state: compactText(v.state),
    decisions: compactText(v.decisions),
    blockers: compactText(v.blockers),
    sources: compactText(v.sources),
    history: [],
  };
}
export function parseAdaptive(value: unknown): AdaptiveToday {
  const d = adaptiveDefaults();
  if (!value || typeof value !== "object") return d;
  const v = value as AdaptiveToday;
  if (v.version !== 1 || !Number.isSafeInteger(v.revision) || v.revision < 0)
    throw Error("Invalid Adaptive Today store; existing data was kept.");
  d.revision = v.revision;
  if (["low", "normal", "focused"].includes(v.mode)) d.mode = v.mode;
  if (agents.some((a) => a.id === v.favorite)) d.favorite = v.favorite;
  d.timeAware = v.timeAware === true;
  const seen = new Set<string>();
  if (Array.isArray(v.sections))
    d.sections = [
      ...v.sections.flatMap((s) => {
        if (!s || !TODAY_SECTIONS.some(([id]) => id === s.id) || seen.has(s.id)) return [];
        seen.add(s.id);
        return [{ id: s.id, hidden: s.hidden === true, collapsed: s.collapsed === true }];
      }),
      ...d.sections.filter((s) => !seen.has(s.id)),
    ];
  if (Array.isArray(v.checkpoints))
    d.checkpoints = v.checkpoints.slice(0, 30).map((c) => {
      const parsed = checkpoint(c);
      if (!parsed) throw Error("Invalid saved checkpoint; existing data was kept.");
      parsed.history = Array.isArray(c.history)
        ? c.history.slice(-3).flatMap((h) => {
            const p = checkpoint(h);
            if (!p) return [];
            const { history: _, ...entry } = p;
            void _;
            return [entry];
          })
        : [];
      return parsed;
    });
  return d;
}
export function preferencePatch(
  current: AdaptiveToday,
  patch: Record<string, unknown>,
): AdaptiveToday {
  return parseAdaptive({
    ...current,
    mode: patch["mode"] ?? current.mode,
    favorite: patch["favorite"] ?? current.favorite,
    timeAware: patch["timeAware"] ?? current.timeAware,
    sections: patch["sections"] ?? current.sections,
  });
}
export type Commitment = {
  id: string;
  title: string;
  start: number;
  end: number;
  allDay: boolean;
  kind: "calendar" | "task" | "reminder";
};
export function adaptiveBrief(
  tasks: TodayTask[],
  commitments: Commitment[],
  prefs: AdaptiveToday,
  now: number,
  zone: string,
) {
  const next =
    commitments
      .filter((e) => e.end > now && !e.allDay)
      .sort((a, b) => Number(b.start <= now) - Number(a.start <= now) || a.start - b.start)[0] ??
    null;
  const available = next ? Math.max(0, Math.floor((next.start - now) / 60000) - 5) : null;
  const open = tasks.filter(
    (t) => t.status === "open" && (!t.at || zoneDateKey(t.at, zone) <= zoneDateKey(now, zone)),
  );
  const ranked = [...open].sort((a, b) => {
    const fit = (t: TodayTask) => (available !== null && t.mins && t.mins > available ? 1 : 0);
    const energy = (t: TodayTask) =>
      prefs.mode === "low" ? (t.energy === "high" ? 2 : t.size === "L" ? 1 : 0) : 0;
    return (
      fit(a) - fit(b) ||
      energy(a) - energy(b) ||
      Number(b.tier === "must") - Number(a.tier === "must") ||
      (a.at ?? Infinity) - (b.at ?? Infinity) ||
      a.createdAt - b.createdAt
    );
  });
  const task = ranked[0] ?? null;
  return {
    task,
    next,
    available,
    step: task ? fallbackStartStep(task.title, "first") : "Name one thing you would like to begin.",
    reason: task
      ? available !== null
        ? "A place to start around your next scheduled commitment."
        : "One manageable starting point; you can choose another."
      : "No need to plan everything. Choose one small starting point.",
    later: ranked.slice(1, 3),
    alternatives: ranked.slice(1, 3),
  };
}

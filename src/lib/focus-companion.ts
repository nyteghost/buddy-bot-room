import { agents, type AgentId } from "./agents";
import { cleanStartStep, cleanStartTask } from "./focus-assist";

/** Saved only by an explicit "Save my place" action, in this browser's localStorage. */
export const FOCUS_CHECKPOINT_KEY = "pixel-pals-focus-checkpoint-v1";
export const COMPANION_MODES = ["quiet", "checkins", "steps"] as const;
export type CompanionMode = (typeof COMPANION_MODES)[number];

export type FocusSession = {
  task: string;
  step: string;
  pal: AgentId;
  mode: CompanionMode;
  completed: string[];
};

export function makeFocusSession(task: unknown, step: unknown, pal: AgentId, mode: CompanionMode): FocusSession | null {
  const validTask = cleanStartTask(task);
  const validStep = cleanStartStep(step);
  if (!validTask || !validStep) return null;
  return { task: validTask, step: validStep, pal, mode, completed: [] };
}

/** Treat localStorage as untrusted input: validate lengths, identifiers and structure. */
export function readFocusCheckpoint(raw: string | null): FocusSession | null {
  if (!raw || raw.length > 4000) return null;
  try {
    const data = JSON.parse(raw) as Partial<FocusSession>;
    if (!data || typeof data !== "object") return null;
    const task = cleanStartTask(data.task);
    const step = cleanStartStep(data.step);
    if (!task || !step || !agents.some((a) => a.id === data.pal)) return null;
    if (!COMPANION_MODES.includes(data.mode as CompanionMode)) return null;
    const completed = Array.isArray(data.completed)
      ? data.completed.filter((item): item is string => typeof item === "string")
          .slice(-8).map((item) => cleanStartStep(item)).filter((item): item is string => item !== null)
      : [];
    return { task, step, pal: data.pal as AgentId, mode: data.mode as CompanionMode, completed };
  } catch { return null; }
}

/** The Pal's illustrated parallel work is a visual metaphor, not claimed file access. */
export function companionActivity(task: string): string {
  if (/schedul|spreadsheet|event|show|calendar/i.test(task)) return "Looking through a sample plan";
  if (/email|reply|inbox|message/i.test(task)) return "Practicing with a sample message";
  if (/write|report|document|draft/i.test(task)) return "Drafting a sample outline";
  if (/clean|tidy|organize/i.test(task)) return "Sorting items in the pixel room";
  if (/code|program|debug|build/i.test(task)) return "Working through a sample problem";
  if (/study|read|research|learn/i.test(task)) return "Reading along in the pixel room";
  return "Working quietly beside you";
}

import { zoneDateKey } from "./day-overview";
import type { Todo } from "./workbench";

export type Energy = "low" | "steady" | "high";
export type FocusPick = { task: Todo; reason: string; estimatedMinutes: number; isDue: boolean; score: number };
export const ENERGY_OPTIONS: readonly Energy[] = ["low", "steady", "high"];
/** Rough, transparent estimates rather than AI claims about real-world duration. */
export function approximateTaskMinutes(text: string): number {
  if (/\b(reply|email|call|text|check|review|send|read|pick up|pay|book|find)\b/i.test(text)) return 10;
  if (/\b(clean|tidy|organize|laundry|dishes|sort)\b/i.test(text)) return 20;
  if (/\b(schedule|plan|write|report|prepare|exercise|workout)\b/i.test(text)) return 30;
  if (/\b(build|assemble|repair|install|create|develop)\b/i.test(text)) return 45;
  return 15;
}

/** Pick one feasible action. Never silently change task priority, dates, or reminders. */
export function chooseFocusTask(todos: readonly Todo[], opts: {
  now: number; zone: string; minutes: number; energy: Energy; skipIds?: readonly string[];
}): FocusPick | null {
  const today = zoneDateKey(opts.now, opts.zone);
  const skipped = new Set(opts.skipIds ?? []);
  const candidates = todos.filter(t => !t.done && !!t.text.trim() && !skipped.has(t.id));
  const ranked = candidates.map((task, index) => {
    const due = task.dueDate ?? (task.scheduledAt ? zoneDateKey(task.scheduledAt, opts.zone) : null);
    const isDue = !!due && due <= today;
    const nearDue = !!due && due > today && (Date.parse(due) - Date.parse(today)) / 86400000 <= 2;
    const estimate = approximateTaskMinutes(task.text);
    const difficulty = estimate <= 10 ? 0 : estimate <= 20 ? 1 : estimate <= 30 ? 2 : 3;
    const energyFit = opts.energy === "low" ? -difficulty * 8 : opts.energy === "high" ? difficulty * 4 : -Math.abs(difficulty - 1) * 3;
    const available = Number.isFinite(opts.minutes) && opts.minutes > 0 ? opts.minutes : 15;
    const timeFit = estimate <= available ? 25 : -Math.min(30, estimate - available);
    const score = (isDue ? 80 : nearDue ? 35 : 0) + (task.important ? 48 : 0)
      + timeFit + energyFit - index * .05;
    const reason = isDue ? "This is on your list for today or earlier."
      : task.important ? "You marked this as important."
      : nearDue ? "Its planned day is coming up soon."
      : estimate <= available ? "A manageable place to start with the time you have."
      : "We can still begin with a tiny first step.";
    return { task, estimatedMinutes: estimate, score, isDue, reason };
  });
  ranked.sort((a, b) => b.score - a.score);
  return ranked[0] ?? null;
}

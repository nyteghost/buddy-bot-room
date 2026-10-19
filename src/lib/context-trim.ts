/** Keep prompts short: drop the oldest turns once the transcript passes a character budget. Pure. */
export type Trimmable = { role: string; text: string };

export const DEFAULT_CONTEXT_CHARS = 12000;
export const MIN_CONTEXT_CHARS = 2000;
export const MAX_CONTEXT_CHARS = 60000;

export function clampBudget(value: unknown): number {
  const n = typeof value === "number" && Number.isFinite(value) ? Math.floor(value) : DEFAULT_CONTEXT_CHARS;
  return Math.min(MAX_CONTEXT_CHARS, Math.max(MIN_CONTEXT_CHARS, n));
}

/**
 * Returns how many items to skip from the front so the rest fits the budget.
 * The newest item is always kept, however long it is, so the latest question is never lost.
 */
export function trimStart(items: Trimmable[], budget: number): number {
  let used = 0;
  let keepFrom = items.length;
  for (let i = items.length - 1; i >= 0; i--) {
    const len = (items[i]?.text.length ?? 0) + 12;
    if (i < items.length - 1 && used + len > budget) break;
    used += len;
    keepFrom = i;
  }
  return keepFrom;
}

export function trimTranscript<T extends Trimmable>(items: T[], budget: number): { kept: T[]; dropped: number } {
  const start = trimStart(items, budget);
  return { kept: items.slice(start), dropped: start };
}

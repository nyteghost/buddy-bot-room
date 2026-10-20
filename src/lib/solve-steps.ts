/** Pulls the numbered steps out of a Problem solving plan ("Steps: 1. … 2. …") so they can go to Tasks in one click. */
export function extractSteps(text: string): string[] {
  const steps: string[] = [];
  for (const line of text.split(/\r?\n/)) {
    const m = /^\s*(?:[-*]\s*)?\d{1,2}[.)]\s+(.+?)\s*$/.exec(line);
    if (m?.[1]) steps.push(m[1].replace(/\*\*/g, "").slice(0, 200));
    if (steps.length >= 8) break;
  }
  return steps;
}
/** The three working roles in Problem solving, by seat. */
export const SOLVE_ROLE_ORDER = ["diagnoser", "fixer", "skeptic"] as const;

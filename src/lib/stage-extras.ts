// Rails, skirting and ADA ramp math for the Stage Deck planner, plus the
// "have vs. need" check used by the crew sheet. Pure functions, no React.

export type EdgeMode = "none" | "front" | "front-sides" | "all";
export const EDGE_MODES: { value: EdgeMode; label: string }[] = [
  { value: "none", label: "None" },
  { value: "front", label: "Front only" },
  { value: "front-sides", label: "Front + sides" },
  { value: "all", label: "All four sides" },
];

/** Default width of a stair or ramp opening in a rail line (feet). */
export const OPENING_FT = 4;

export type StageExtras = {
  rails: EdgeMode;
  skirts: EdgeMode;
  ramps: number; // ADA ramps on this stage (each takes an opening at the front)
};
export const NO_EXTRAS: StageExtras = { rails: "none", skirts: "none", ramps: 0 };

export type Parts = { rail8: number; rail4: number; skirt8: number; ramp: number };
export const NO_PARTS: Parts = { rail8: 0, rail4: 0, skirt8: 0, ramp: 0 };

/** Lengths (ft) of the sides covered by a mode. width = front/back, length = left/right. */
export function sideLengths(mode: EdgeMode, width: number, length: number) {
  const front = mode === "none" ? [] : [width];
  const sides = mode === "front-sides" || mode === "all" ? [length, length] : [];
  const back = mode === "all" ? [width] : [];
  return { front, sides, back };
}

/** Fill one run with 8 ft pieces, finishing with a 4 ft piece when the leftover is 4 ft or less. */
export function fillRun(runFt: number): { eight: number; four: number } {
  if (!(runFt > 0)) return { eight: 0, four: 0 };
  let eight = Math.floor(runFt / 8);
  const rest = runFt - eight * 8;
  let four = 0;
  if (rest > 4) eight++;
  else if (rest > 0) four++;
  return { eight, four };
}

export function railParts(
  e: StageExtras, width: number, length: number, stairCount: number, quantity = 1,
): Pick<Parts, "rail8" | "rail4"> {
  const { front, sides, back } = sideLengths(e.rails, width, length);
  const openings = (stairCount + e.ramps) * OPENING_FT;
  let rail8 = 0, rail4 = 0;
  front.forEach((len) => {
    const f = fillRun(len - openings);
    rail8 += f.eight; rail4 += f.four;
  });
  [...sides, ...back].forEach((len) => {
    const f = fillRun(len);
    rail8 += f.eight; rail4 += f.four;
  });
  return { rail8: rail8 * quantity, rail4: rail4 * quantity };
}

export function skirtParts(e: StageExtras, width: number, length: number, quantity = 1): number {
  const { front, sides, back } = sideLengths(e.skirts, width, length);
  return [...front, ...sides, ...back].reduce((n, len) => n + Math.ceil(len / 8), 0) * quantity;
}

/** ADA ramp run: 1 inch of rise needs 12 inches of run, so the run in feet equals the height in inches. */
export function rampRunFt(heightIn: number): number {
  return Math.max(0, heightIn);
}

export function stageParts(
  e: StageExtras, width: number, length: number, stairCount: number, quantity = 1,
): Parts {
  return { ...railParts(e, width, length, stairCount, quantity), skirt8: skirtParts(e, width, length, quantity), ramp: e.ramps * quantity };
}

export function addParts(a: Parts, b: Parts): Parts {
  return { rail8: a.rail8 + b.rail8, rail4: a.rail4 + b.rail4, skirt8: a.skirt8 + b.skirt8, ramp: a.ramp + b.ramp };
}

/** What the warehouse has. null = nobody has counted yet. */
export type Have = { rail8: number | null; rail4: number | null; skirt8: number | null; ramp: number | null };
export const DEFAULT_HAVE: Have = { rail8: null, rail4: null, skirt8: null, ramp: 1 };

export type LineStatus = { key: keyof Parts; label: string; need: number; have: number | null; status: "ok" | "short" | "unknown" | "unused"; short: number };
const LABELS: Record<keyof Parts, string> = { rail8: "8 ft rails", rail4: "4 ft rails", skirt8: "8 ft skirts", ramp: "ADA ramp" };

export function checkParts(need: Parts, have: Have): LineStatus[] {
  return (Object.keys(LABELS) as (keyof Parts)[]).map((key) => {
    const n = need[key];
    const h = have[key];
    if (n === 0) return { key, label: LABELS[key], need: n, have: h, status: "unused", short: 0 };
    if (h === null) return { key, label: LABELS[key], need: n, have: h, status: "unknown", short: 0 };
    return { key, label: LABELS[key], need: n, have: h, status: n > h ? "short" : "ok", short: Math.max(0, n - h) };
  });
}

/** Parse a "how many do we have" box: blank means not counted yet. */
export function parseHave(text: string): number | null {
  const t = text.trim();
  if (t === "") return null;
  const n = Math.floor(Number(t));
  return Number.isFinite(n) && n >= 0 ? n : null;
}

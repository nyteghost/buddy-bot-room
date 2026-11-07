/**
 * Living World body proportions for native 32px sprites.
 *
 * The original 32×32 models are chibi-proportioned (head ≈ 43% of the figure, legs ≈ 5 rows), which
 * reads as short and wide next to the detailed room backdrops. Rather than squeezing or stretching
 * pixels, legs are lengthened by repeating the sprite's own topmost leg row: every pixel stays square,
 * heads, faces and outfits are untouched, and the result is a 32-wide grid that is a few rows taller.
 * Classic mode and the stored character art are not changed; this is applied only when drawing a frame.
 */
export type WorldBodyType = "humanoid" | "compact" | "robot" | "creature" | "floating" | "object";
/** Extra leg rows per body type: tall adults get the most, mascots and floaters keep their shape. */
export const WORLD_LEG_EXTENSION: Record<WorldBodyType, number> = { humanoid: 6, compact: 4, robot: 4, creature: 2, floating: 0, object: 0 };

const PAL_BODIES: Record<string, WorldBodyType> = { mimic: "object" };
const GUEST_BODIES: Record<string, WorldBodyType> = {
 "arcade-ghost": "floating", "tiny-dragon": "creature", "pixel-robot": "robot", homer: "compact",
};
export const worldPalBody = (id: string): WorldBodyType => PAL_BODIES[id] ?? "humanoid";
export const worldGuestBody = (id: string): WorldBodyType => GUEST_BODIES[id] ?? "humanoid";

const runsOf = (row: string) => {
 const runs: [number, number][] = [];
 for (let x = 0; x < row.length; x++) {
  if (row[x] === ".") continue;
  const start = x;
  while (x + 1 < row.length && row[x + 1] !== ".") x++;
  runs.push([start, x]);
 }
 return runs;
};
/**
 * Row index where the legs begin: the top of the bottom block of rows drawn as two separate,
 * narrow columns. Returns -1 when the figure has no legs (ghosts, chests, blobs).
 */
export function worldLegStart(grid: readonly string[]): number {
 let bottom = grid.length - 1;
 while (bottom >= 0 && !grid[bottom]!.replace(/\./g, "")) bottom--;
 const twoLegs = (y: number) => {
  const runs = runsOf(grid[y] ?? "");
  return runs.length === 2 && runs.every(([a, b]) => b - a + 1 <= 9);
 };
 // Shoes may be wider than legs, so look a few rows above the lowest row for the leg block.
 let y = bottom;
 while (y >= 0 && y > bottom - 4 && !twoLegs(y)) y--;
 if (y < 0 || !twoLegs(y)) return -1;
 while (y - 1 >= 0 && twoLegs(y - 1)) y--;
 return y;
}
/**
 * Insert `extra` copies of the leg row. Width stays 32. Pass `legRow` from the character's front view
 * (worldLegStart of its south sprite) so side and back views, where legs overlap, grow at the same height.
 * Returns the input unchanged when there are no legs.
 */
export function worldTallSprite(grid: readonly string[], extra: number, legRow?: number): string[] {
 const rows = Math.max(0, Math.min(12, Math.floor(Number.isFinite(extra) ? extra : 0)));
 let start = !rows ? -1 : legRow !== undefined && Number.isInteger(legRow) ? legRow : worldLegStart(grid);
 if (start < 0 || start >= grid.length) return [...grid];
 // A lifted foot can leave the chosen row empty in one walk frame: copy the nearest drawn row below.
 while (start < grid.length - 1 && !grid[start]!.replace(/\./g, "")) start++;
 if (!grid[start]!.replace(/\./g, "")) return [...grid];
 return [...grid.slice(0, start + 1), ...Array.from({ length: rows }, () => grid[start]!), ...grid.slice(start + 1)];
}
const legRows = new Map<string, number>();
/** Cached leg row for a character's front model. */
export function worldLegRow(key: string, front: () => readonly string[]): number {
 let row = legRows.get(key);
 if (row === undefined) { row = worldLegStart(front()); legRows.set(key, row); }
 return row;
}

/**
 * One in-room scale for every Living World actor (owner/PM visual feedback 2026-11-07: the cast must
 * share a consistent apparent height, foot line and pixel density; mascots and creatures are
 * intentional, declared exceptions — never an arbitrary per-character stretch).
 *
 * The unit is the *world pixel*: one native 32px-sprite pixel, drawn at `--world-pixel` CSS px
 * (styles.css). A standard adult human stands WORLD_HUMAN_ROWS world pixels tall from the top of the
 * head to the lowest foot pixel. Native Pals already measure that after the Living World leg
 * extension. HD256 art is sized so its measured figure matches the same height (times its declared
 * height class) and its lowest foot pixel lands on the floor anchor.
 */
export const WORLD_HUMAN_ROWS = 35;

/** Declared in-room heights relative to a standard adult. `adult` is the default when a pack says nothing. */
export const WORLD_HEIGHT_CLASSES = { tiny: 0.4, small: 0.6, child: 0.8, adult: 1, tall: 1.15, huge: 1.5 } as const;
export type WorldHeightClass = keyof typeof WORLD_HEIGHT_CLASSES;
export const WORLD_HEIGHT_CLASS_NAMES = Object.keys(WORLD_HEIGHT_CLASSES) as WorldHeightClass[];
export const isWorldHeightClass = (value: unknown): value is WorldHeightClass =>
 typeof value === "string" && Object.prototype.hasOwnProperty.call(WORLD_HEIGHT_CLASSES, value);

/** Mirrors the `--world-pixel` media rules in styles.css (kept in sync by a test). */
export function worldPixelSize(phone: boolean, devicePixelRatio: number): number {
 const dpr = Number.isFinite(devicePixelRatio) && devicePixelRatio > 0 ? devicePixelRatio : 1;
 if (phone) return dpr >= 2.5 ? 1.3334 : 1.5;
 return dpr >= 1.2 && dpr <= 1.3 ? 1.6 : 2;
}

/** Standard adult figure height in CSS px for a world pixel size. */
export const worldHumanHeight = (worldPixel: number) => WORLD_HUMAN_ROWS * worldPixel;

/** Opaque bounds of one HD256 reference frame, in canvas pixels. `foot` is the lowest opaque row. */
export type WorldFrameMetrics = { grid: number; top: number; foot: number };
export type WorldHdScale = {
 /** CSS px for the full 256 canvas. */ size: number;
 /** CSS px the canvas is lowered so the lowest foot pixel sits on the floor anchor. */ footOffset: number;
 /** Every art pixel covers a whole number of device pixels. */ crisp: boolean;
 /** Achieved figure height ÷ intended height (1 = exact). Reported, never hidden. */ heightRatio: number;
 /** CSS px per art pixel (grid art) or per canvas pixel (painted art). */ artPixel: number;
};

/** Grid art snaps to whole device pixels when that keeps the figure within this fraction of its intended height. */
export const WORLD_CRISP_TOLERANCE = 0.125;
const round3 = (value: number) => Math.round(value * 1000) / 1000;

/**
 * Size an HD256 canvas from its measured figure. The figure (top of head → lowest foot pixel) is made
 * `WORLD_HUMAN_ROWS × worldPixel × height class` CSS px tall. Grid-aligned pixel art is snapped to a whole
 * number of device pixels per art pixel when that stays within WORLD_CRISP_TOLERANCE of the intended
 * height; otherwise the exact height wins and the result reports `crisp: false` so the pack can be redrawn
 * at the documented size instead of being silently distorted.
 */
export function worldHdScale({ metrics, height = "adult", worldPixel, devicePixelRatio, canvas = 256 }: {
 metrics: WorldFrameMetrics | null | undefined; height?: WorldHeightClass | undefined; worldPixel: number; devicePixelRatio: number; canvas?: number;
}): WorldHdScale {
 const dpr = Number.isFinite(devicePixelRatio) && devicePixelRatio > 0 ? devicePixelRatio : 1;
 const ratio = WORLD_HEIGHT_CLASSES[isWorldHeightClass(height) ? height : "adult"];
 const target = worldHumanHeight(worldPixel) * ratio;
 const valid = !!metrics && Number.isFinite(metrics.top) && Number.isFinite(metrics.foot) && metrics.foot >= metrics.top && metrics.foot < canvas;
 // Unmeasured art: assume the documented layout (figure fills rows 8–247 of 256).
 const top = valid ? Math.max(0, metrics!.top) : 8, foot = valid ? metrics!.foot : canvas - 9;
 const figure = foot - top + 1;
 const grid = valid && Number.isInteger(metrics!.grid) && metrics!.grid >= 2 && canvas % metrics!.grid === 0 ? metrics!.grid : 1;
 let size = Math.min(target * canvas / Math.max(16, figure), target * 8);
 let crisp = false;
 if (grid > 1) {
  const master = canvas / grid, multiple = size * dpr / master, whole = Math.max(1, Math.round(multiple));
  if (Math.abs(whole - multiple) / multiple <= WORLD_CRISP_TOLERANCE) { size = whole * master / dpr; crisp = true; }
 }
 return {
  size: round3(size),
  footOffset: round3((canvas - 1 - foot) * size / canvas),
  crisp,
  heightRatio: round3(figure * size / canvas / target),
  artPixel: round3(size / canvas * grid),
 };
}

/** Last opaque row of a native sprite grid ("." is transparent); -1 when empty. */
export function worldGridFoot(grid: readonly string[]): number {
 for (let y = grid.length - 1; y >= 0; y--) if (grid[y]!.replace(/\./g, "")) return y;
 return -1;
}
/**
 * Native sprites: drop the transparent rows under the standing foot line so, with bottom-aligned
 * drawing, the feet touch the floor anchor exactly like HD art. `standingFoot` comes from the
 * character's front idle sprite, so walk frames and hops never shift; a frame that draws below it is
 * left untouched.
 */
export function worldGroundGrid(grid: readonly string[], standingFoot: number): string[] {
 if (!Number.isInteger(standingFoot) || standingFoot < 0 || standingFoot >= grid.length - 1) return [...grid];
 for (let y = standingFoot + 1; y < grid.length; y++) if (grid[y]!.replace(/\./g, "")) return [...grid];
 return grid.slice(0, standingFoot + 1);
}
const feet = new Map<string, number>();
/** Cached standing foot row for a character's (tall) front sprite. */
export function worldStandingFoot(key: string, front: () => readonly string[]): number {
 let row = feet.get(key);
 if (row === undefined) { row = worldGridFoot(front()); feet.set(key, row); }
 return row;
}

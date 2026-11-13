import type { WorldHdDirection } from "./world-hd";
import type { GroundPoint, WorldProjection } from "./world-iso-projection";

/**
 * Living Universe — isometric ground engine (Step 1a): eight-direction facing.
 *
 * Facing is chosen from the character's ON-SCREEN direction of travel (the designer's recommendation),
 * so south stays "towards the viewer" and north "away". On a 2:1 floor the four diagonal facings follow
 * the floor lines, which run at 26.565° (atan ½) on screen, so the eight facings are not evenly spaced:
 *
 *   e 0° · se 26.6° · s 90° · sw 153.4° · w 180° · nw 206.6° · n 270° · ne 333.4°   (screen, y grows down)
 *
 * The art for a diagonal facing is a true three-quarter view (body turned 45° from the front); only the
 * direction of travel on screen uses the 26.6° floor line. Facings are never mirrored: west-side facings
 * are separately authored art, and a missing facing falls back through `selectWorldHdClip`, unchanged.
 */
const DIAGONAL = Math.atan2(1, 2) * 180 / Math.PI; // 26.565…
export const WORLD_ISO_FACING_ANGLES: Readonly<Record<WorldHdDirection, number>> = Object.freeze({
 e: 0, se: DIAGONAL, s: 90, sw: 180 - DIAGONAL, w: 180, nw: 180 + DIAGONAL, n: 270, ne: 360 - DIAGONAL,
});
const ORDER: readonly WorldHdDirection[] = ["e", "se", "s", "sw", "w", "nw", "n", "ne"];
/** Minimum time (ms) a new facing must be wanted before the sprite switches. */
export const WORLD_ISO_FACING_HOLD_MS = 120;

const gap = (a: number, b: number) => { const d = Math.abs(a - b) % 360; return d > 180 ? 360 - d : d; };

/** Nearest isometric facing for an on-screen movement (dx, dy) in world px; `fallback` when not moving. */
export function worldIsoFacingOf(dx: number, dy: number, fallback: WorldHdDirection = "s"): WorldHdDirection {
 if (!Number.isFinite(dx) || !Number.isFinite(dy) || Math.hypot(dx, dy) < 1e-9) return fallback;
 const angle = (Math.atan2(dy, dx) * 180 / Math.PI + 360) % 360;
 let best: WorldHdDirection = "e", bestGap = Infinity;
 for (const d of ORDER) { const g = gap(angle, WORLD_ISO_FACING_ANGLES[d]); if (g < bestGap - 1e-9) { best = d; bestGap = g; } }
 return best;
}

/** Facing for a ground movement, through a projection (iso or flat). */
export function worldIsoGroundFacing(projection: WorldProjection, from: GroundPoint, to: GroundPoint, fallback: WorldHdDirection = "s"): WorldHdDirection {
 const s = projection.screenVector(to.u - from.u, to.v - from.v);
 return worldIsoFacingOf(s.x, s.y, fallback);
}

/** Jitter guard state: the facing on screen, plus a candidate waiting out the hold. */
export type WorldIsoFacingHold = Readonly<{ shown: WorldHdDirection; pending: WorldHdDirection | null; since: number }>;
export const worldIsoFacingHoldStart = (facing: WorldHdDirection = "s", now = 0): WorldIsoFacingHold => ({ shown: facing, pending: null, since: now });

/**
 * Advance the jitter guard. A new facing replaces the shown one only after it has been wanted
 * continuously for `holdMs`; a path running exactly along a sector boundary therefore cannot flicker.
 * `immediate` (arriving at an anchor, teleport after a pause, reduced motion) switches at once.
 */
export function worldIsoFacingStep(state: WorldIsoFacingHold, wanted: WorldHdDirection, now: number, holdMs = WORLD_ISO_FACING_HOLD_MS, immediate = false): WorldIsoFacingHold {
 if (wanted === state.shown) return state.pending === null ? state : { shown: state.shown, pending: null, since: now };
 if (immediate) return { shown: wanted, pending: null, since: now };
 if (state.pending !== wanted) return { shown: state.shown, pending: wanted, since: now };
 return now - state.since >= holdMs ? { shown: wanted, pending: null, since: now } : state;
}

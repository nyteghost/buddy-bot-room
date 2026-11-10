import type { WorldHdClip } from "./world-hd";

/**
 * Living Universe — isometric ground engine (Step 1a): distance-based walk playback.
 *
 * Two different things are easy to confuse:
 * - IMPORT: a Character Universe v3 pack stores each frame with an authored `durationMs` (40–10000 ms).
 *   The importer (character-zip.ts) validates and stores those numbers; this module changes nothing there.
 * - PLAYBACK: today's rooms play every clip by elapsed time (`worldHdFrameAt`), so a walk keeps cycling
 *   at the same rate whatever speed the character moves — feet slide. This module is the planned
 *   isometric alternative: it reads the same authored durations as the shape of ONE stride cycle at the
 *   reference speed, and picks the frame from the ground distance walked. Walk faster, the legs move
 *   faster; stop, the legs stop. It is a pure helper and no current room calls it.
 *
 * Frame indices are ZERO-BASED. For the approved six-frame walk (one full two-step cycle) the contact
 * poses are index 0 (left heel) and index 3 (right heel) — "frames 1 and 4" when counted from one.
 *
 * SPEED CONTRACT. `speed` is a character's reference stride speed in tiles per second. It sets the stride
 * length (one cycle covers cycle-seconds × speed tiles) and is meant to stay constant for a character. It is
 * NOT the character's instantaneous velocity: how fast the character is moving right now never enters
 * these functions, only how far it has moved. A missing, zero, negative or non-finite speed means the
 * reference speed.
 *
 * TWO WAYS TO DRIVE IT.
 * - Stateless: `worldIsoWalkFrameIndex(clip, totalDistance)`. Correct while the clip and stride speed never
 *   change during a walk.
 * - Phase accumulator: keep one number in [0, 1) per character, advance it with
 *   `worldIsoWalkPhaseAdvance(phase, distanceDelta, clip, speed)` each tick and read
 *   `worldIsoWalkFrameAtPhase(clip, phase)`. Changing the stride speed (or swapping to another facing's
 *   clip) between ticks keeps the phase, so the pose never jumps backwards or skips. Zero, negative or
 *   non-finite deltas hold the phase: standing still holds the pose for as long as needed.
 *
 * STOPPING. `worldIsoWalkPhaseToContact` gives the extra distance to walk so the stop lands on the start
 * of a contact frame. Non-looping clips clamp at their last frame instead of wrapping.
 *
 * BAD CLIPS. Frames whose duration is not a positive finite number get no share of the cycle and are never
 * shown. A clip with fewer than two usable frames (or no frames at all) always shows frame 0. No function here
 * returns NaN or an index outside the clip, and none of them modifies the clip.
 *
 * NOT VERIFIED HERE (needs the renderer and real frames): that feet do not visibly slide (the art's actual
 * stride must match cycle-seconds × speed), that contact poses really are drawn at the contact indices,
 * blending between walk and idle, and how acceleration looks.
 */
/** Reference walking speed in ground tiles per second (about 1.2 m/s at the approved scale). */
export const WORLD_ISO_WALK_SPEED = 1.6;
/** Zero-based contact frames of the approved six-frame walk. */
export const WORLD_ISO_WALK_CONTACTS: readonly number[] = Object.freeze([0, 3]);

/** Zero-based contact (heel-strike) frames for a walk of `frameCount` frames: the cycle start and its half-way frame. */
export function worldIsoWalkContacts(frameCount: number): number[] {
 if (!Number.isSafeInteger(frameCount) || frameCount < 1) return [];
 return frameCount < 2 ? [0] : [0, Math.floor(frameCount / 2)];
}

const duration = (f: { durationMs: number } | undefined) => f && typeof f.durationMs === "number" && Number.isFinite(f.durationMs) && f.durationMs > 0 ? f.durationMs : 0;
const framesOf = (clip: WorldHdClip | null | undefined) => clip && Array.isArray(clip.frames) ? clip.frames : [];
const cycleMs = (clip: WorldHdClip) => framesOf(clip).reduce((sum, f) => sum + duration(f), 0);
const strideSpeed = (speed: number | undefined) => typeof speed === "number" && Number.isFinite(speed) && speed > 0 ? speed : WORLD_ISO_WALK_SPEED;
/** A cycle that can be played: at least two frames with a usable duration and a finite total. */
const playable = (clip: WorldHdClip) => framesOf(clip).filter(f => duration(f) > 0).length >= 2 && Number.isFinite(cycleMs(clip));
const LAST = 1 - 1e-9;
const cleanPhase = (phase: number) => typeof phase === "number" && Number.isFinite(phase) ? Math.min(LAST, Math.max(0, phase)) : 0;

/** Ground distance (tiles) one full walk cycle covers at stride speed `speed`; 0 for a clip with no usable duration. */
export function worldIsoWalkCycleTiles(clip: WorldHdClip, speed = WORLD_ISO_WALK_SPEED): number {
 const tiles = cycleMs(clip) / 1000 * strideSpeed(speed);
 return Number.isFinite(tiles) ? tiles : 0;
}

export type WorldIsoWalkOptions = Readonly<{ speed?: number; reduced?: boolean }>;
/**
 * Zero-based frame at cycle phase `phase` (0 = start of frame 0, just under 1 = end of the last frame). Each
 * frame owns a share of the cycle equal to its share of the authored cycle time. Reduced motion, an
 * unplayable clip or a bad phase shows frame 0, a contact pose.
 */
export function worldIsoWalkFrameAtPhase(clip: WorldHdClip, phase: number, options: Pick<WorldIsoWalkOptions, "reduced"> = {}): number {
 if (options.reduced || !playable(clip)) return 0;
 const frames = framesOf(clip), total = cycleMs(clip);
 let at = cleanPhase(phase) * total, last = 0;
 for (let i = 0; i < frames.length; i++) {
  const d = duration(frames[i]);
  if (!d) continue;
  if (at < d) return i;
  at -= d; last = i;
 }
 return last;
}

/**
 * Advance a character's walk phase by `distanceDelta` tiles walked since the last tick. Looping clips wrap;
 * non-looping clips clamp at the end. A zero, negative or non-finite delta, or an unplayable clip, returns
 * the (cleaned) phase unchanged.
 */
export function worldIsoWalkPhaseAdvance(phase: number, distanceDelta: number, clip: WorldHdClip, speed = WORLD_ISO_WALK_SPEED): number {
 const from = cleanPhase(phase);
 if (!playable(clip) || typeof distanceDelta !== "number" || !Number.isFinite(distanceDelta) || distanceDelta <= 0) return from;
 const cycle = worldIsoWalkCycleTiles(clip, speed);
 if (!(cycle > 0)) return from;
 const next = from + distanceDelta / cycle;
 if (!Number.isFinite(next)) return from;
 return clip.loop ? cleanPhase(next - Math.floor(next)) : Math.min(LAST, next);
}

/**
 * Extra distance (tiles) to walk from `phase` so the walk stops exactly at the start of the next contact
 * frame; 0 when already there. Non-looping clips only look ahead: with no contact left before the end the
 * answer is 0 (the clip holds where it is).
 */
export function worldIsoWalkPhaseToContact(clip: WorldHdClip, phase: number, speed = WORLD_ISO_WALK_SPEED): number {
 if (!playable(clip)) return 0;
 const frames = framesOf(clip), total = cycleMs(clip), cycle = worldIsoWalkCycleTiles(clip, speed), at = cleanPhase(phase);
 if (!(cycle > 0)) return 0;
 const starts: number[] = [];
 let t = 0;
 for (const f of frames) { starts.push(t / total); t += duration(f); }
 let best = Infinity;
 for (const index of worldIsoWalkContacts(frames.length)) {
  if (!duration(frames[index])) continue; // a contact frame with no share of the cycle cannot be stopped on
  let ahead = starts[index]! - at;
  if (Math.abs(ahead) < 1e-9 || Math.abs(ahead - 1) < 1e-9 || Math.abs(ahead + 1) < 1e-9) return 0;
  if (ahead < 0) { if (!clip.loop) continue; ahead += 1; }
  best = Math.min(best, ahead);
 }
 return Number.isFinite(best) ? best * cycle : 0;
}

/** Cycle phase reached after walking `distance` tiles from a standing start (stateless form). */
function phaseOfDistance(clip: WorldHdClip, distance: number, speed: number | undefined): number {
 if (!playable(clip) || typeof distance !== "number" || !Number.isFinite(distance) || distance <= 0) return 0;
 const cycle = worldIsoWalkCycleTiles(clip, speed);
 if (!(cycle > 0)) return 0;
 const turns = distance / cycle;
 return clip.loop ? cleanPhase(turns - Math.floor(turns)) : Math.min(LAST, turns);
}

/**
 * Zero-based walk frame for `distance` tiles walked in total (stateless form; see the module comment for
 * when to use the phase accumulator instead). Reduced motion and any invalid input show frame 0.
 */
export function worldIsoWalkFrameIndex(clip: WorldHdClip, distance: number, options: WorldIsoWalkOptions = {}): number {
 if (options.reduced) return 0;
 return worldIsoWalkFrameAtPhase(clip, phaseOfDistance(clip, distance, options.speed));
}

/** Ground distance still to walk from `distance` until the next contact frame starts (stateless form of `worldIsoWalkPhaseToContact`). */
export function worldIsoWalkDistanceToContact(clip: WorldHdClip, distance: number, speed = WORLD_ISO_WALK_SPEED): number {
 if (typeof distance !== "number" || !Number.isFinite(distance) || distance < 0) return 0;
 return worldIsoWalkPhaseToContact(clip, phaseOfDistance(clip, distance, speed), speed);
}

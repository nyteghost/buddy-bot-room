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

const cycleMs = (clip: WorldHdClip) => clip.frames.reduce((sum, f) => sum + (Number.isFinite(f.durationMs) && f.durationMs > 0 ? f.durationMs : 0), 0);

/** Ground distance (tiles) one full walk cycle covers at `speed`. */
export function worldIsoWalkCycleTiles(clip: WorldHdClip, speed = WORLD_ISO_WALK_SPEED): number {
 return cycleMs(clip) / 1000 * (Number.isFinite(speed) && speed > 0 ? speed : WORLD_ISO_WALK_SPEED);
}

export type WorldIsoWalkOptions = Readonly<{ speed?: number; reduced?: boolean }>;
/**
 * Zero-based walk frame for `distance` tiles walked. Each frame owns a share of the cycle distance equal
 * to its share of the authored cycle time. Reduced motion (and any invalid input) shows frame 0, a
 * contact pose with both feet on the ground line.
 */
export function worldIsoWalkFrameIndex(clip: WorldHdClip, distance: number, options: WorldIsoWalkOptions = {}): number {
 const total = cycleMs(clip), frames = clip.frames.length;
 if (options.reduced || frames < 2 || !total || !Number.isFinite(distance) || distance <= 0) return 0;
 const cycle = worldIsoWalkCycleTiles(clip, options.speed);
 const phase = clip.loop ? (distance % cycle) / cycle : Math.min(distance / cycle, 1 - 1e-9);
 let at = phase * total;
 for (let i = 0; i < frames; i++) {
  const d = clip.frames[i]!.durationMs;
  if (at < d) return i;
  at -= d;
 }
 return frames - 1;
}

/** Ground distance still to walk from `distance` until the next contact frame starts (for stopping on a contact pose). */
export function worldIsoWalkDistanceToContact(clip: WorldHdClip, distance: number, speed = WORLD_ISO_WALK_SPEED): number {
 const total = cycleMs(clip), cycle = worldIsoWalkCycleTiles(clip, speed);
 if (!total || clip.frames.length < 2 || !Number.isFinite(distance) || distance < 0) return 0;
 const starts: number[] = [];
 let t = 0;
 for (const f of clip.frames) { starts.push(t / total * cycle); t += f.durationMs; }
 const into = distance % cycle;
 const contacts = worldIsoWalkContacts(clip.frames.length).map(i => starts[i]!);
 const ahead = contacts.map(c => (c - into + cycle) % cycle);
 return Math.min(...ahead);
}

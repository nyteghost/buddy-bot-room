import { describe, expect, it } from "vitest";
import type { WorldHdClip } from "@/lib/world-hd";
import { worldHdFrameAt } from "@/lib/world-hd-animation";
import {
 WORLD_ISO_WALK_CONTACTS, WORLD_ISO_WALK_SPEED, worldIsoWalkContacts, worldIsoWalkCycleTiles, worldIsoWalkDistanceToContact, worldIsoWalkFrameAtPhase,
 worldIsoWalkFrameIndex, worldIsoWalkPhaseAdvance, worldIsoWalkPhaseToContact,
} from "@/lib/world-iso-gait";

/** The approved Gate A walk: six frames, one full two-step cycle, 120 ms each. Frame names are zero-based. */
const WALK: WorldHdClip = { loop: true, frames: Array.from({ length: 6 }, (_, i) => ({ src: `walk-${i}`, durationMs: 120 })) };

describe("zero-based walk contact convention", () => {
 it("locks the six-frame contact poses at index 0 and index 3 (frames 1 and 4 counted from one)", () => {
  expect(WORLD_ISO_WALK_CONTACTS).toEqual([0, 3]);
  expect(worldIsoWalkContacts(6)).toEqual([0, 3]);
  expect(worldIsoWalkContacts(8)).toEqual([0, 4]);
  expect(worldIsoWalkContacts(1)).toEqual([0]);
  expect(worldIsoWalkContacts(0)).toEqual([]);
 });
});

describe("distance-based walk playback", () => {
 it("one cycle covers 0.72 s × 1.6 tiles/s = 1.152 tiles at the reference speed", () => {
  expect(WORLD_ISO_WALK_SPEED).toBe(1.6);
  expect(worldIsoWalkCycleTiles(WALK)).toBeCloseTo(1.152, 9);
 });

 it("steps through frames 0…5 by distance and loops", () => {
  const share = worldIsoWalkCycleTiles(WALK) / 6;
  for (let i = 0; i < 6; i++) expect(worldIsoWalkFrameIndex(WALK, share * i + share / 2)).toBe(i);
  expect(worldIsoWalkFrameIndex(WALK, worldIsoWalkCycleTiles(WALK) + share / 2)).toBe(0);
 });

 it("ties the legs to the ground at any speed: same distance, same frame", () => {
  // Reaching 0.5 tile at 0.5×, 1× and 2× the reference speed takes 625, 312.5 and 156.25 ms.
  const speeds = [0.8, 1.6, 3.2], distance = 0.5;
  const byTime = speeds.map(s => worldHdFrameAt(WALK, distance / s * 1000));
  const byDistance = speeds.map(() => worldIsoWalkFrameIndex(WALK, distance));
  expect(new Set(byTime).size).toBe(3);      // today's time-based playback shows three different poses: feet slide
  expect(new Set(byDistance).size).toBe(1);  // distance-based playback shows the same pose: feet stay planted
  // Standing still: time-based playback keeps cycling; distance-based holds the pose.
  expect(worldHdFrameAt(WALK, 300)).not.toBe(worldHdFrameAt(WALK, 0));
  expect(worldIsoWalkFrameIndex(WALK, 0.5)).toBe(byDistance[0]);
 });

 it("covers more ground per cycle when the character is set to walk faster", () => {
  expect(worldIsoWalkCycleTiles(WALK, 3.2)).toBeCloseTo(2 * worldIsoWalkCycleTiles(WALK), 9);
  expect(worldIsoWalkFrameIndex(WALK, 0.5, { speed: 3.2 })).toBeLessThan(worldIsoWalkFrameIndex(WALK, 0.5));
 });

 it("gives each frame a share of the stride equal to its share of the authored time", () => {
  const uneven: WorldHdClip = { loop: true, frames: [{ src: "a", durationMs: 300 }, { src: "b", durationMs: 100 }] };
  const cycle = worldIsoWalkCycleTiles(uneven);
  expect(worldIsoWalkFrameIndex(uneven, cycle * 0.74)).toBe(0);
  expect(worldIsoWalkFrameIndex(uneven, cycle * 0.76)).toBe(1);
 });

 it("starts on a contact pose and shows frame 0 for reduced motion or bad input", () => {
  expect(worldIsoWalkFrameIndex(WALK, 0)).toBe(0);
  expect(worldIsoWalkFrameIndex(WALK, 0.6, { reduced: true })).toBe(0);
  expect(worldIsoWalkFrameIndex(WALK, Number.NaN)).toBe(0);
  expect(worldIsoWalkFrameIndex({ loop: true, frames: [{ src: "only", durationMs: 120 }] }, 2)).toBe(0);
 });

 it("measures how far to walk before stopping on the next contact pose", () => {
  const cycle = worldIsoWalkCycleTiles(WALK), half = cycle / 2;
  expect(worldIsoWalkDistanceToContact(WALK, 0)).toBe(0);
  expect(worldIsoWalkDistanceToContact(WALK, half)).toBeCloseTo(0, 9);
  expect(worldIsoWalkDistanceToContact(WALK, half - 0.1)).toBeCloseTo(0.1, 9);
  expect(worldIsoWalkDistanceToContact(WALK, cycle - 0.05)).toBeCloseTo(0.05, 9);
  const stopAt = 0.4 + worldIsoWalkDistanceToContact(WALK, 0.4);
  expect(WORLD_ISO_WALK_CONTACTS).toContain(worldIsoWalkFrameIndex(WALK, stopAt + 1e-9));
 });

 it("leaves the authored frame durations untouched (import data is not rewritten)", () => {
  const copy = JSON.stringify(WALK);
  worldIsoWalkFrameIndex(WALK, 3.3); worldIsoWalkDistanceToContact(WALK, 1.1);
  expect(JSON.stringify(WALK)).toBe(copy);
 });
});

// ---------- Final Step 1a hardening (Core + QA review of 2e1c9d1) ----------
const clipOf = (durations: readonly number[], loop = true): WorldHdClip => ({ loop, frames: durations.map((durationMs, i) => ({ src: `f${i}`, durationMs })) });
const UNEVEN = clipOf([200, 80, 120, 160, 90, 110]);       // contacts at 0 and 3
const EIGHT = clipOf([100, 100, 100, 100, 100, 100, 100, 100]); // contacts at 0 and 4
const valid = (clip: WorldHdClip, index: number) => Number.isInteger(index) && index >= 0 && index < Math.max(1, clip.frames.length);

describe("walk phase accumulator: continuity when the stride speed or clip changes", () => {
 it("agrees with the stateless form while speed is constant", () => {
  let phase = 0, walked = 0;
  for (let k = 0; k < 500; k++) {
   phase = worldIsoWalkPhaseAdvance(phase, 0.013, UNEVEN); walked += 0.013;
   // Summing 500 small steps drifts by ~1e-13, so exactly on a frame boundary either neighbour is acceptable.
   const expected = worldIsoWalkFrameIndex(UNEVEN, walked);
   expect([worldIsoWalkFrameAtPhase(UNEVEN, Math.max(0, phase - 1e-7)), worldIsoWalkFrameAtPhase(UNEVEN, phase), worldIsoWalkFrameAtPhase(UNEVEN, Math.min(0.999999, phase + 1e-7))]).toContain(expected);
  }
 });

 it("never steps backwards or skips a frame when the stride speed changes mid-walk", () => {
  for (const clip of [WALK, UNEVEN, EIGHT]) {
   const n = clip.frames.length;
   let phase = 0, last = 0, seen = 0;
   for (let k = 0; k < 2400; k++) {
    const speed = k < 600 ? 1.6 : k < 1200 ? 0.8 : k < 1800 ? 3.2 : 1.1; // three changes, mid-stride
    phase = worldIsoWalkPhaseAdvance(phase, 0.004, clip, speed);
    const frame = worldIsoWalkFrameAtPhase(clip, phase), step = (frame - last + n) % n;
    if (step > 1) throw new Error(`frame jumped ${last} → ${frame} at tick ${k}`);
    seen += step; last = frame;
    expect(phase >= 0 && phase < 1).toBe(true);
   }
   expect(seen).toBeGreaterThan(n * 3); // it really cycled several times
  }
 });

 it("shows why: the stateless form jumps when its speed argument changes, the accumulator does not", () => {
  const walked = 2.0; // tiles so far at 1.6
  const before = worldIsoWalkFrameIndex(WALK, walked), statelessAfter = worldIsoWalkFrameIndex(WALK, walked, { speed: 2.3 });
  expect(statelessAfter).not.toBe(before);
  let phase = 0;
  for (let k = 0; k < 200; k++) phase = worldIsoWalkPhaseAdvance(phase, 0.01, WALK);
  expect(worldIsoWalkFrameAtPhase(WALK, phase)).toBe(before);
  expect(worldIsoWalkFrameAtPhase(WALK, worldIsoWalkPhaseAdvance(phase, 0, WALK, 2.3))).toBe(before); // speed changed, no distance: same pose
 });

 it("keeps the phase when swapping to another facing's clip with the same timing", () => {
  let phase = 0;
  for (let k = 0; k < 37; k++) phase = worldIsoWalkPhaseAdvance(phase, 0.02, WALK);
  const other: WorldHdClip = { loop: true, frames: WALK.frames.map((f, i) => ({ src: `se-walk-${i}`, durationMs: f.durationMs })) };
  expect(worldIsoWalkFrameAtPhase(other, phase)).toBe(worldIsoWalkFrameAtPhase(WALK, phase));
 });

 it("holds the pose indefinitely while standing still, and ignores bad distance steps", () => {
  let phase = worldIsoWalkPhaseAdvance(0, 0.5, WALK);
  const pose = worldIsoWalkFrameAtPhase(WALK, phase), held = phase;
  for (let k = 0; k < 10000; k++) phase = worldIsoWalkPhaseAdvance(phase, 0, WALK);
  for (const delta of [-0.3, Number.NaN, Infinity, -Infinity, -0]) phase = worldIsoWalkPhaseAdvance(phase, delta, WALK);
  expect(phase).toBe(held);
  expect(worldIsoWalkFrameAtPhase(WALK, phase)).toBe(pose);
 });

 it("cleans a bad starting phase and treats a bad stride speed as the reference speed", () => {
  for (const bad of [Number.NaN, Infinity, -Infinity, -2]) expect(worldIsoWalkPhaseAdvance(bad, 0, WALK)).toBe(0);
  expect(worldIsoWalkPhaseAdvance(7, 0, WALK)).toBeLessThan(1);
  for (const speed of [0, -1, Number.NaN, Infinity]) {
   expect(worldIsoWalkPhaseAdvance(0, 0.3, WALK, speed)).toBeCloseTo(worldIsoWalkPhaseAdvance(0, 0.3, WALK), 12);
   expect(worldIsoWalkCycleTiles(WALK, speed)).toBeCloseTo(1.152, 9);
  }
 });
});

describe("safe stopping on a contact pose", () => {
 it("is 0 at a contact start and otherwise lands exactly on a contact frame (even, uneven and eight-frame walks)", () => {
  for (const clip of [WALK, UNEVEN, EIGHT]) {
   const contacts = worldIsoWalkContacts(clip.frames.length), cycle = worldIsoWalkCycleTiles(clip);
   expect(worldIsoWalkPhaseToContact(clip, 0)).toBe(0);
   for (let k = 1; k < 200; k++) {
    const phase = k / 200, extra = worldIsoWalkPhaseToContact(clip, phase);
    expect(extra).toBeGreaterThanOrEqual(0);
    expect(extra).toBeLessThanOrEqual(cycle + 1e-9);
    const stopped = worldIsoWalkPhaseAdvance(phase, extra + 1e-9, clip);
    expect(contacts).toContain(worldIsoWalkFrameAtPhase(clip, stopped));
    expect(worldIsoWalkPhaseToContact(clip, stopped)).toBeLessThan(1e-6); // already there: no second stride needed
   }
  }
 });

 it("matches the stateless distance form and scales with stride speed", () => {
  for (const d of [0.05, 0.4, 0.77, 1.3, 5.21]) {
   let phase = 0;
   phase = worldIsoWalkPhaseAdvance(phase, d, UNEVEN);
   expect(worldIsoWalkDistanceToContact(UNEVEN, d)).toBeCloseTo(worldIsoWalkPhaseToContact(UNEVEN, phase), 9);
  }
  expect(worldIsoWalkPhaseToContact(WALK, 0.25, 3.2)).toBeCloseTo(2 * worldIsoWalkPhaseToContact(WALK, 0.25), 9);
 });

 it("non-looping clips clamp at the last frame and only look ahead for a contact", () => {
  const once = clipOf([120, 120, 120, 120, 120, 120], false);
  let phase = 0;
  for (let k = 0; k < 400; k++) phase = worldIsoWalkPhaseAdvance(phase, 0.05, once);
  expect(phase).toBeLessThan(1);
  expect(worldIsoWalkFrameAtPhase(once, phase)).toBe(5);
  expect(worldIsoWalkFrameIndex(once, 99)).toBe(5);
  expect(worldIsoWalkPhaseToContact(once, 0.2)).toBeCloseTo(0.3 * worldIsoWalkCycleTiles(once), 9); // contact at frame 3 = phase 0.5
  expect(worldIsoWalkPhaseToContact(once, 0.8)).toBe(0); // no contact left before the end: hold
  expect(worldIsoWalkDistanceToContact(once, 99)).toBe(0);
 });
});

describe("unusable clips and reduced motion never produce a bad frame", () => {
 const BAD: WorldHdClip[] = [
  clipOf([]), clipOf([120]), clipOf([0, 0, 0]), clipOf([-5, -5]), clipOf([Number.NaN, Number.NaN, Number.NaN]), clipOf([Infinity, 120]),
  clipOf([120, Number.NaN, 120, -1, 0, 120]), clipOf([0, 120, 120, 0, 120, 120]),
  { loop: true, frames: undefined } as unknown as WorldHdClip,
 ];

 it("always returns a real frame index and finite distances", () => {
  for (const clip of BAD) for (const x of [0, 0.3, 1, 7.7, Number.NaN, -1, Infinity]) {
   const frames = Array.isArray(clip.frames) ? clip : clipOf([]);
   for (const index of [worldIsoWalkFrameIndex(clip, x), worldIsoWalkFrameAtPhase(clip, x)]) expect(valid(frames, index)).toBe(true);
   for (const n of [worldIsoWalkCycleTiles(clip), worldIsoWalkDistanceToContact(clip, x), worldIsoWalkPhaseToContact(clip, x), worldIsoWalkPhaseAdvance(x, 0.2, clip)]) {
    expect(Number.isFinite(n)).toBe(true); expect(n).toBeGreaterThanOrEqual(0);
   }
  }
 });

 it("shows frame 0 for clips with no usable duration or fewer than two frames", () => {
  for (const clip of BAD.slice(0, 6)) { expect(worldIsoWalkFrameIndex(clip, 0.9)).toBe(0); expect(worldIsoWalkFrameAtPhase(clip, 0.6)).toBe(0); }
 });

 it("gives frames with a bad duration no share of the cycle, and never selects them", () => {
  const mixed = clipOf([120, Number.NaN, 120, -1, 0, 120]); // usable: 0, 2, 5
  expect(worldIsoWalkCycleTiles(mixed)).toBeCloseTo(0.36 * 1.6, 9);
  const shown = new Set<number>();
  for (let k = 0; k < 300; k++) shown.add(worldIsoWalkFrameAtPhase(mixed, k / 300));
  expect([...shown].sort()).toEqual([0, 2, 5]);
  // Contact frame 3 has no share here, so stopping aims for contact 0 only.
  const stop = worldIsoWalkPhaseAdvance(0.4, worldIsoWalkPhaseToContact(mixed, 0.4) + 1e-9, mixed);
  expect(worldIsoWalkFrameAtPhase(mixed, stop)).toBe(0);
 });

 it("reduced motion shows frame 0 through every frame function", () => {
  for (const clip of [WALK, UNEVEN, EIGHT]) for (const x of [0.1, 0.5, 0.99, 3.3]) {
   expect(worldIsoWalkFrameAtPhase(clip, x, { reduced: true })).toBe(0);
   expect(worldIsoWalkFrameIndex(clip, x, { reduced: true })).toBe(0);
   expect(worldIsoWalkFrameIndex(clip, x, { reduced: true, speed: 3 })).toBe(0);
  }
  expect(WORLD_ISO_WALK_CONTACTS).toContain(0); // frame 0 is a contact pose: both feet on the ground line
 });

 it("never modifies a clip", () => {
  for (const clip of [WALK, UNEVEN, ...BAD.slice(0, 8)]) {
   const copy = JSON.stringify(clip);
   worldIsoWalkPhaseAdvance(0.3, 0.4, clip, 2); worldIsoWalkFrameAtPhase(clip, 0.7); worldIsoWalkPhaseToContact(clip, 0.2); worldIsoWalkFrameIndex(clip, 2.2); worldIsoWalkDistanceToContact(clip, 1.1);
   expect(JSON.stringify(clip)).toBe(copy);
  }
 });
});

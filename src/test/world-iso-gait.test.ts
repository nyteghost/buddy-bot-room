import { describe, expect, it } from "vitest";
import type { WorldHdClip } from "@/lib/world-hd";
import { worldHdFrameAt } from "@/lib/world-hd-animation";
import {
 WORLD_ISO_WALK_CONTACTS, WORLD_ISO_WALK_SPEED, worldIsoWalkContacts, worldIsoWalkCycleTiles, worldIsoWalkDistanceToContact, worldIsoWalkFrameIndex,
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

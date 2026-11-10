import { describe, expect, it } from "vitest";
import { WorldIsoCrowd } from "@/lib/world-iso-crowd";
import { WORLD_ISO_GREYBOX } from "@/lib/world-iso-greybox";
import { WORLD_ISO_PAL_IDS, worldIsoSchedule } from "@/lib/world-iso-schedule";
import { worldIsoSealPlan } from "@/lib/world-iso-ground";

const anchor = (id: string) => WORLD_ISO_GREYBOX.anchors.find(a => a.id === id)!;
describe("Step 1b isolated crowd reservations", () => {
 it("places nine Pals and six visitors simultaneously without collisions", () => {
  const crowd = new WorldIsoCrowd();
  const roster = worldIsoSchedule(WORLD_ISO_PAL_IDS.map(id => ({ id, name: id, enabled: true, real: null })),
   Array.from({ length: 6 }, (_, i) => ({ id: String(i), name: "Guest" })), 0);
  for (const a of roster) expect(crowd.join({ id: a.id, at: anchor(a.home).at, kind: a.kind })).toBe(true);
  expect(crowd.ids()).toHaveLength(15);
  expect(crowd.valid()).toBe(true);
  expect(crowd.join({ id: "excess", at: anchor("door").at, kind: "visitor" })).toBe(false);
 });
 it("moves a character along verified ground segments, with no teleporting", () => {
  const crowd = new WorldIsoCrowd();
  expect(crowd.join({ id: "pal:nova", kind: "pal", at: anchor("door").at })).toBe(true);
  expect(crowd.assign("pal:nova", anchor("visitor-home-4").at)).toBe(true);
  let last = crowd.pose("pal:nova")!.at, moved = 0;
  for (let i = 0; i < 200; i++) {
   crowd.step(50);
   const now = crowd.pose("pal:nova")!.at;
   const delta = Math.hypot(now.u - last.u, now.v - last.v);
   expect(delta).toBeLessThanOrEqual(0.081);
   expect(crowd.valid()).toBe(true);
   moved += delta; last = now;
  }
  expect(moved).toBeGreaterThan(0.5);
  expect(Math.hypot(last.u - anchor("visitor-home-4").at.u, last.v - anchor("visitor-home-4").at.v)).toBeLessThan(0.03);
 });
 it("never lets two head-on actors overlap or exchange positions in one tick", () => {
  const plan = worldIsoSealPlan({ id: "cross", floor: [{ u: 0, v: 0 }, { u: 10, v: 0 }, { u: 10, v: 8 }, { u: 0, v: 8 }],
   colliders: [], anchors: [{ id: "door", kind: "door", at: { u: 1, v: 1 }, facing: "s" }], door: "door" })!;
  const crowd = new WorldIsoCrowd(plan);
  expect(crowd.join({ id: "pal:1", kind: "pal", at: { u: 2, v: 4 } })).toBe(true);
  expect(crowd.join({ id: "guest:2", kind: "visitor", at: { u: 8, v: 4 } })).toBe(true);
  expect(crowd.assign("pal:1", { u: 8, v: 4 })).toBe(true);
  expect(crowd.assign("guest:2", { u: 2, v: 4 })).toBe(true);
  for (let i = 0; i < 80; i++) { crowd.step(100); expect(crowd.valid()).toBe(true); }
 });
 it("rejects unsafe plans and invalid targets and respects pause", () => {
  expect(() => new WorldIsoCrowd({ ...WORLD_ISO_GREYBOX })).toThrow();
  expect(() => new WorldIsoCrowd(WORLD_ISO_GREYBOX, NaN)).toThrow();
  const crowd = new WorldIsoCrowd();
  expect(crowd.join({ id: "one", kind: "pal", at: { u: 4, v: 2.5 } })).toBe(false);
  expect(crowd.join({ id: "one", kind: "pal", at: anchor("door").at })).toBe(true);
  expect(crowd.join({ id: "one", kind: "pal", at: anchor("door").at })).toBe(false);
  expect(crowd.assign("one", { u: 4, v: 2.5 })).toBe(false);
  crowd.assign("one", anchor("visitor-home-4").at);
  const before = crowd.pose("one");
  crowd.step(50, true);
  expect(crowd.pose("one")?.at).toEqual(before?.at);
  crowd.leave("one");
  expect(crowd.pose("one")).toBeNull();
 });
});

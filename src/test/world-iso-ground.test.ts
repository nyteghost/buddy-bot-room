import { describe, expect, it } from "vitest";
import {
 WORLD_ISO_FOOTPRINT, worldIsoBoxDistance, worldIsoInsidePolygon, worldIsoPath, worldIsoPathLength, worldIsoPointFree,
 worldIsoSegmentClear, worldIsoValidatePlan, type GroundPlan,
} from "@/lib/world-iso-ground";

/** A small synthetic room: 10 × 8 tiles with a wall of desks across the middle and one gap. */
const ROOM: GroundPlan = {
 id: "synthetic-room",
 floor: [{ u: 0, v: 0 }, { u: 10, v: 0 }, { u: 10, v: 8 }, { u: 0, v: 8 }],
 colliders: [{ id: "left", u1: 0, v1: 3.5, u2: 4, v2: 4.5 }, { id: "right", u1: 5.5, v1: 3.5, u2: 10, v2: 4.5 }],
 anchors: [
  { id: "door", kind: "door", at: { u: 2, v: 7.5 }, facing: "n" },
  { id: "far", kind: "visitor", at: { u: 8, v: 1 }, facing: "s" },
 ],
 door: "door",
};
const r = WORLD_ISO_FOOTPRINT;
const clearOfColliders = (plan: GroundPlan, path: readonly { u: number; v: number }[]) => {
 for (let i = 1; i < path.length; i++) {
  const a = path[i - 1]!, b = path[i]!, steps = Math.ceil(Math.hypot(b.u - a.u, b.v - a.v) / 0.02);
  for (let k = 0; k <= steps; k++) {
   const p = { u: a.u + (b.u - a.u) * k / steps, v: a.v + (b.v - a.v) * k / steps };
   for (const c of plan.colliders) if (worldIsoBoxDistance(p, c) < r - 1e-6) return false;
  }
 }
 return true;
};

describe("walkable floor and colliders", () => {
 it("tests points against the floor polygon", () => {
  const tri = [{ u: 0, v: 0 }, { u: 4, v: 0 }, { u: 0, v: 4 }];
  expect(worldIsoInsidePolygon({ u: 1, v: 1 }, tri)).toBe(true);
  expect(worldIsoInsidePolygon({ u: 3, v: 3 }, tri)).toBe(false);
 });

 it("keeps the whole footprint inside the floor and off furniture", () => {
  expect(worldIsoPointFree(ROOM, { u: 5, v: 6 })).toBe(true);
  expect(worldIsoPointFree(ROOM, { u: 0.2, v: 6 })).toBe(false);   // footprint crosses the wall
  expect(worldIsoPointFree(ROOM, { u: 2, v: 4 })).toBe(false);     // inside a desk
  expect(worldIsoPointFree(ROOM, { u: 2, v: 4.7 })).toBe(false);   // feet free, footprint touches the desk
  expect(worldIsoPointFree(ROOM, { u: 2, v: 4.81 })).toBe(true);
  expect(worldIsoPointFree(ROOM, { u: 11, v: 3 })).toBe(false);    // off the floor
  expect(worldIsoPointFree(ROOM, { u: Number.NaN, v: 3 })).toBe(false);
 });

 it("checks straight walks along their whole length", () => {
  expect(worldIsoSegmentClear(ROOM, { u: 2, v: 6 }, { u: 2, v: 1 })).toBe(false);
  expect(worldIsoSegmentClear(ROOM, { u: 4.75, v: 6 }, { u: 4.75, v: 1 })).toBe(true);
 });
});

describe("half-tile A* paths", () => {
 it("walks around furniture through the gap, keeping the footprint clear", () => {
  const path = worldIsoPath(ROOM, { u: 2, v: 7.5 }, { u: 8, v: 1 })!;
  expect(path).not.toBeNull();
  expect(path[0]).toEqual({ u: 2, v: 7.5 });
  expect(path.at(-1)).toEqual({ u: 8, v: 1 });
  expect(clearOfColliders(ROOM, path)).toBe(true);
  expect(path.some(p => p.u > 4 + r - 1e-6 && p.u < 5.5 - r + 1e-6)).toBe(true); // a corner in the gap
  for (const p of path) expect(worldIsoPointFree(ROOM, p)).toBe(true);
 });

 it("is a reasonable length (smoothed, not a zig-zag)", () => {
  const path = worldIsoPath(ROOM, { u: 2, v: 7.5 }, { u: 8, v: 1 })!;
  const direct = Math.hypot(6, 6.5);
  expect(worldIsoPathLength(path)).toBeLessThan(direct * 1.25);
  expect(path.length).toBeLessThanOrEqual(5);
 });

 it("returns a straight two-point path when nothing is in the way", () => {
  expect(worldIsoPath(ROOM, { u: 1, v: 6 }, { u: 9, v: 7 })).toEqual([{ u: 1, v: 6 }, { u: 9, v: 7 }]);
 });

 it("returns null for blocked endpoints and for unreachable targets", () => {
  expect(worldIsoPath(ROOM, { u: 2, v: 4 }, { u: 8, v: 1 })).toBeNull();
  const sealed: GroundPlan = { ...ROOM, colliders: [{ id: "wall", u1: 0, v1: 3.5, u2: 10, v2: 4.5 }] };
  expect(worldIsoPath(sealed, { u: 2, v: 7.5 }, { u: 8, v: 1 })).toBeNull();
 });

 it("refuses a gap narrower than one footprint", () => {
  const narrow: GroundPlan = { ...ROOM, colliders: [{ id: "left", u1: 0, v1: 3.5, u2: 4.75, v2: 4.5 }, { id: "right", u1: 5.25, v1: 3.5, u2: 10, v2: 4.5 }] };
  expect(worldIsoPath(narrow, { u: 2, v: 7.5 }, { u: 8, v: 1 })).toBeNull();
 });

 it("is deterministic", () => {
  const a = worldIsoPath(ROOM, { u: 9, v: 7.5 }, { u: 1, v: 1 }), b = worldIsoPath(ROOM, { u: 9, v: 7.5 }, { u: 1, v: 1 });
  expect(a).toEqual(b);
 });
});

describe("plan validation", () => {
 it("accepts a good plan and reports walking distance from the door", () => {
  const report = worldIsoValidatePlan(ROOM);
  expect(report.ok).toBe(true);
  expect(report.routes["door"]).toBe(0);
  expect(report.routes["far"]!).toBeGreaterThan(8);
 });

 it("names each kind of problem", () => {
  const codes = (plan: GroundPlan) => worldIsoValidatePlan(plan).problems.map(p => p.code);
  expect(codes({ ...ROOM, door: "nope" })).toContain("door-missing");
  expect(codes({ ...ROOM, floor: [{ u: 0, v: 0 }, { u: 1, v: 1 }] })).toContain("floor-invalid");
  expect(codes({ ...ROOM, colliders: [...ROOM.colliders, { id: "bad", u1: 3, v1: 1, u2: 2, v2: 2 }] })).toContain("collider-invalid");
  expect(codes({ ...ROOM, colliders: [...ROOM.colliders, { id: "on-left", u1: 3, v1: 4, u2: 5, v2: 5 }] })).toContain("collider-overlap");
  expect(codes({ ...ROOM, anchors: [...ROOM.anchors, { id: "in-desk", kind: "visitor", at: { u: 2, v: 4 }, facing: "s" }] })).toContain("anchor-blocked");
  expect(codes({ ...ROOM, colliders: [{ id: "wall", u1: 0, v1: 3.5, u2: 10, v2: 4.5 }] })).toContain("anchor-unreachable");
  expect(codes({ ...ROOM, anchors: [...ROOM.anchors, { id: "near-far", kind: "visitor", at: { u: 8.4, v: 1 }, facing: "s" }] })).toContain("anchor-crowded");
  expect(codes({ ...ROOM, anchors: [...ROOM.anchors, { id: "door", kind: "visitor", at: { u: 5, v: 6 }, facing: "s" }] })).toContain("duplicate-id");
  expect(codes({ ...ROOM, anchors: [...ROOM.anchors, { id: "seat-x", kind: "seat", at: { u: 5, v: 6 }, facing: "se" }] })).toContain("seat-link-missing");
 });
});

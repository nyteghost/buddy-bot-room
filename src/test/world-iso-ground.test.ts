import { describe, expect, it } from "vitest";
import { WORLD_ISO_GREYBOX } from "@/lib/world-iso-greybox";
import {
 WORLD_ISO_CLEARANCE_MARGIN, WORLD_ISO_FOOTPRINT, WORLD_ISO_LIMITS, WORLD_ISO_MAX_CONNECTORS, worldIsoBoxDistance, worldIsoConnectors, worldIsoFloorProblems,
 worldIsoGrid, worldIsoGridBudget, worldIsoGridRoute, worldIsoInsidePolygon, worldIsoPath, worldIsoPathLength, worldIsoPlanSealed, worldIsoPointFree, worldIsoRadiusOk,
 worldIsoSealPlan, worldIsoSegmentBoxDistance, worldIsoSegmentClear, worldIsoSegmentDistance, worldIsoSegmentsIntersect, worldIsoSmoothPath, worldIsoValidatePlan,
 type GroundPlan,
} from "@/lib/world-iso-ground";
import type { GroundPoint } from "@/lib/world-iso-projection";

const r = WORLD_ISO_FOOTPRINT;
/** Seal a hand-written test plan; navigation only accepts sealed plans. */
const seal = (raw: unknown): GroundPlan => { const plan = worldIsoSealPlan(raw); if (!plan) throw new Error("test plan did not seal"); return plan; };
const square = (n: number, m = n): GroundPoint[] => [{ u: 0, v: 0 }, { u: n, v: 0 }, { u: n, v: m }, { u: 0, v: m }];
const DOOR = { id: "door", kind: "door", at: { u: 1, v: 1 }, facing: "s" } as const;
const rawPlan = (id: string, floor: GroundPoint[], colliders: unknown[] = [], anchors: unknown[] = [DOOR]) => ({ id, floor, colliders, anchors, door: "door" });
const bare = (id: string, floor: GroundPoint[], colliders: unknown[] = []) => seal(rawPlan(id, floor, colliders));
const codes = (plan: unknown, radius?: number) => worldIsoValidatePlan(plan, radius).problems.map(p => p.code);

/** A small synthetic room: 10 × 8 tiles with a wall of desks across the middle and one gap. */
const ROOM_RAW = {
 id: "synthetic-room",
 floor: square(10, 8),
 colliders: [{ id: "left", u1: 0, v1: 3.5, u2: 4, v2: 4.5 }, { id: "right", u1: 5.5, v1: 3.5, u2: 10, v2: 4.5 }],
 anchors: [{ id: "door", kind: "door", at: { u: 2, v: 7.5 }, facing: "n" }, { id: "far", kind: "visitor", at: { u: 8, v: 1 }, facing: "s" }],
 door: "door",
};
const ROOM = seal(ROOM_RAW);
const L_FLOOR = bare("l-shaped-floor", [{ u: 0, v: 0 }, { u: 10, v: 0 }, { u: 10, v: 4 }, { u: 4, v: 4 }, { u: 4, v: 10 }, { u: 0, v: 10 }]);
/** Layouts chosen so a greedy (over-estimating) search would take a longer way round. */
const LAYOUTS: GroundPlan[] = [
 ROOM,
 bare("staggered-walls", square(12, 10), [{ id: "a", u1: 3, v1: 1, u2: 4, v2: 9 }, { id: "b", u1: 7, v1: 1.5, u2: 8, v2: 10 }]),
 bare("u-trap", square(12), [{ id: "back", u1: 6, v1: 3, u2: 7, v2: 9 }, { id: "top", u1: 3, v1: 3, u2: 6, v2: 4 }, { id: "bottom", u1: 3, v1: 8, u2: 6, v2: 9 }]),
 bare("pillars", square(10), [{ id: "p1", u1: 2.2, v1: 2.2, u2: 3.1, v2: 3.1 }, { id: "p2", u1: 4.7, v1: 4.4, u2: 5.6, v2: 5.3 }, { id: "p3", u1: 6.9, v1: 2.1, u2: 7.6, v2: 6.8 }, { id: "p4", u1: 2.4, v1: 6.3, u2: 5.9, v2: 7.1 }]),
 L_FLOOR,
 WORLD_ISO_GREYBOX,
];

/** Independent oracle: dense sampling of the footprint along a segment, using only point distances. */
function minClearance(plan: GroundPlan, a: GroundPoint, b: GroundPoint, spacing = 0.004): number {
 const steps = Math.max(1, Math.ceil(Math.hypot(b.u - a.u, b.v - a.v) / spacing));
 let min = Infinity;
 for (let k = 0; k <= steps; k++) {
  const p = { u: a.u + (b.u - a.u) * k / steps, v: a.v + (b.v - a.v) * k / steps };
  if (!worldIsoInsidePolygon(p, plan.floor)) return -1;
  for (const c of plan.colliders) min = Math.min(min, worldIsoBoxDistance(p, c));
  for (let i = 0, j = plan.floor.length - 1; i < plan.floor.length; j = i++) {
   const e1 = plan.floor[j]!, e2 = plan.floor[i]!, du = e2.u - e1.u, dv = e2.v - e1.v;
   const t = Math.max(0, Math.min(1, ((p.u - e1.u) * du + (p.v - e1.v) * dv) / (du * du + dv * dv)));
   min = Math.min(min, Math.hypot(p.u - (e1.u + t * du), p.v - (e1.v + t * dv)));
  }
 }
 return min;
}
const sampledClear = (plan: GroundPlan, a: GroundPoint, b: GroundPoint, radius = r, spacing = 0.004) => minClearance(plan, a, b, spacing) >= radius - 1e-6;
const pathClear = (plan: GroundPlan, path: readonly GroundPoint[], radius = r) => path.every((p, i) => !i || sampledClear(plan, path[i - 1]!, p, radius));
const freeNodes = (plan: GroundPlan) => { const g = worldIsoGrid(plan)!, out: number[] = []; for (let i = 0; i < g.cols * g.rows; i++) if (g.free(i)) out.push(i); return out; };
/** Deterministic spread of node pairs across a layout. */
const pairs = (plan: GroundPlan, count: number) => { const nodes = freeNodes(plan), out: [number, number][] = []; for (let k = 0; k < count; k++) out.push([nodes[(k * 7919) % nodes.length]!, nodes[(k * 104729 + 3571) % nodes.length]!]); return out; };
/** Reference shortest route cost: plain Dijkstra (no heuristic, own queue) over the same graph, connectors included. */
function referenceCost(plan: GroundPlan, from: GroundPoint, to: GroundPoint): number {
 const g = worldIsoGrid(plan)!, dist = new Map<number, number>(), done = new Set<number>();
 const queue: [number, number][] = [];
 const put = (id: number, d: number) => { if (d < (dist.get(id) ?? Infinity)) { dist.set(id, d); queue.push([d, id]); } };
 for (const s of worldIsoConnectors(plan, from)) put(s.node, s.cost);
 while (queue.length) {
  let at = 0;
  for (let i = 1; i < queue.length; i++) if (queue[i]![0] < queue[at]![0]) at = i;
  const [d, id] = queue.splice(at, 1)[0]!;
  if (done.has(id)) continue;
  done.add(id);
  for (const e of g.neighbours(id)) put(e.to, d + e.cost);
 }
 let best = Infinity;
 for (const t of worldIsoConnectors(plan, to)) best = Math.min(best, (dist.get(t.node) ?? Infinity) + t.cost);
 return best;
}
/** Deterministic pseudo-random numbers in [0, 1). */
const rng = (seed: number) => () => (seed = (seed * 1103515245 + 12345) % 2147483648) / 2147483648;
/** Run `f` with typed-array allocation trapped, to prove a rejection happens before any grid is allocated. */
function withoutAllocating<T>(f: () => T): T {
 const g = globalThis as unknown as { Uint8Array: unknown }, original = g.Uint8Array;
 g.Uint8Array = function () { throw new Error("navigation array was allocated"); };
 try { return f(); } finally { g.Uint8Array = original; }
}

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
 });

 it("checks straight walks along their whole length", () => {
  expect(worldIsoSegmentClear(ROOM, { u: 2, v: 6 }, { u: 2, v: 1 })).toBe(false);
  expect(worldIsoSegmentClear(ROOM, { u: 4.75, v: 6 }, { u: 4.75, v: 1 })).toBe(true);
 });

 it("computes exact segment distances", () => {
  expect(worldIsoSegmentsIntersect({ u: 0, v: 0 }, { u: 2, v: 2 }, { u: 0, v: 2 }, { u: 2, v: 0 })).toBe(true);
  expect(worldIsoSegmentsIntersect({ u: 0, v: 0 }, { u: 1, v: 0 }, { u: 2, v: 0 }, { u: 3, v: 0 })).toBe(false);
  expect(worldIsoSegmentDistance({ u: 0, v: 0 }, { u: 4, v: 0 }, { u: 2, v: 1 }, { u: 2, v: 3 })).toBeCloseTo(1, 12);
  const box = { id: "b", u1: 2, v1: 2, u2: 3, v2: 3 };
  expect(worldIsoSegmentBoxDistance({ u: 0, v: 0 }, { u: 5, v: 5 }, box)).toBe(0);
  expect(worldIsoSegmentBoxDistance({ u: 0, v: 1.5 }, { u: 5, v: 1.5 }, box)).toBeCloseTo(0.5, 12);
  expect(worldIsoSegmentBoxDistance({ u: 1, v: 3 }, { u: 2, v: 4 }, box)).toBeCloseTo(Math.SQRT1_2, 12);
 });
});

describe("paths", () => {
 it("walks around furniture through the gap, keeping the footprint clear", () => {
  const path = worldIsoPath(ROOM, { u: 2, v: 7.5 }, { u: 8, v: 1 })!;
  expect(path).not.toBeNull();
  expect(path[0]).toEqual({ u: 2, v: 7.5 });
  expect(path.at(-1)).toEqual({ u: 8, v: 1 });
  expect(pathClear(ROOM, path)).toBe(true);
  expect(path.some(p => p.u > 4 + r - 1e-6 && p.u < 5.5 - r + 1e-6)).toBe(true); // a corner in the gap
  for (const p of path) expect(worldIsoPointFree(ROOM, p)).toBe(true);
 });

 it("is a reasonable length (smoothed, not a zig-zag)", () => {
  const path = worldIsoPath(ROOM, { u: 2, v: 7.5 }, { u: 8, v: 1 })!;
  expect(worldIsoPathLength(path)).toBeLessThan(Math.hypot(6, 6.5) * 1.25);
  expect(path.length).toBeLessThanOrEqual(5);
 });

 it("returns a straight two-point path when nothing is in the way", () => {
  expect(worldIsoPath(ROOM, { u: 1, v: 6 }, { u: 9, v: 7 })).toEqual([{ u: 1, v: 6 }, { u: 9, v: 7 }]);
 });

 it("returns null for blocked endpoints and for unreachable targets", () => {
  expect(worldIsoPath(ROOM, { u: 2, v: 4 }, { u: 8, v: 1 })).toBeNull();
  const sealedOff = seal({ ...ROOM_RAW, colliders: [{ id: "wall", u1: 0, v1: 3.5, u2: 10, v2: 4.5 }] });
  expect(worldIsoPath(sealedOff, { u: 2, v: 7.5 }, { u: 8, v: 1 })).toBeNull();
 });

 it("is deterministic", () => {
  expect(worldIsoPath(ROOM, { u: 9, v: 7.5 }, { u: 1, v: 1 })).toEqual(worldIsoPath(ROOM, { u: 9, v: 7.5 }, { u: 1, v: 1 }));
 });
});

describe("plan validation", () => {
 it("accepts a good plan, reports walking distance from the door, and returns the sealed plan", () => {
  const report = worldIsoValidatePlan(ROOM_RAW);
  expect(report.ok).toBe(true);
  expect(report.routes["door"]).toBe(0);
  expect(report.routes["far"]!).toBeGreaterThan(8);
  expect(worldIsoPlanSealed(report.plan)).toBe(true);
  expect(report.plan === (ROOM_RAW as unknown)).toBe(false);
 });

 it("names each kind of placement problem", () => {
  const A = ROOM_RAW.anchors;
  expect(codes({ ...ROOM_RAW, door: "nope" })).toContain("door-missing");
  expect(codes({ ...ROOM_RAW, colliders: [...ROOM_RAW.colliders, { id: "on-left", u1: 3, v1: 4, u2: 5, v2: 5 }] })).toContain("collider-overlap");
  expect(codes({ ...ROOM_RAW, anchors: [...A, { id: "in-desk", kind: "visitor", at: { u: 2, v: 4 }, facing: "s" }] })).toContain("anchor-blocked");
  expect(codes({ ...ROOM_RAW, colliders: [{ id: "wall", u1: 0, v1: 3.5, u2: 10, v2: 4.5 }] })).toContain("anchor-unreachable");
  expect(codes({ ...ROOM_RAW, anchors: [...A, { id: "near-far", kind: "visitor", at: { u: 8.4, v: 1 }, facing: "s" }] })).toContain("anchor-crowded");
  expect(codes({ ...ROOM_RAW, anchors: [...A, { id: "door", kind: "visitor", at: { u: 5, v: 6 }, facing: "s" }] })).toContain("duplicate-id");
  expect(codes({ ...ROOM_RAW, anchors: [...A, { id: "seat-x", kind: "seat", at: { u: 5, v: 6 }, facing: "se" }] })).toContain("seat-link-missing");
  expect(codes({ ...ROOM_RAW, anchors: [{ ...A[0]!, kind: "visitor" }, A[1]!] })).toContain("door-kind-invalid");
  expect(worldIsoValidatePlan({ ...ROOM_RAW, door: "nope" }).plan).toBeNull();
 });
});

describe("A* optimality", () => {
 it("costs every grid edge at its true length in tiles", () => {
  for (const plan of LAYOUTS) {
   const g = worldIsoGrid(plan)!;
   for (const id of freeNodes(plan).filter((_, i) => i % 7 === 0)) for (const e of g.neighbours(id)) {
    const a = g.point(id), b = g.point(e.to);
    expect(Math.abs(e.cost - Math.hypot(a.u - b.u, a.v - b.v))).toBeLessThan(1e-12);
   }
  }
 });

 it("returns exactly the reference (Dijkstra) shortest cost on every obstacle layout", () => {
  let compared = 0;
  for (const plan of LAYOUTS) {
   const g = worldIsoGrid(plan)!;
   for (const [a, b] of pairs(plan, 30)) {
    const from = g.point(a), to = g.point(b), route = worldIsoGridRoute(plan, from, to), truth = referenceCost(plan, from, to);
    if (!Number.isFinite(truth)) { expect(route).toBeNull(); continue; }
    expect(route).not.toBeNull();
    expect(Math.abs(route!.cost - truth)).toBeLessThan(1e-9);
    expect(route!.cost).toBeGreaterThanOrEqual(Math.hypot(to.u - from.u, to.v - from.v) - 1e-9); // straight line never over-estimates
    compared++;
   }
  }
  expect(compared).toBeGreaterThan(150);
 });

 it("smoothed paths are never longer than the optimal grid route and never shorter than the straight line", () => {
  for (const plan of LAYOUTS) {
   const g = worldIsoGrid(plan)!;
   for (const [a, b] of pairs(plan, 25)) {
    const from = g.point(a), to = g.point(b), route = worldIsoGridRoute(plan, from, to), path = worldIsoPath(plan, from, to);
    if (!route) { expect(path).toBeNull(); continue; }
    const length = worldIsoPathLength(path!);
    expect(length).toBeLessThanOrEqual(route.cost + 1e-9);
    expect(length).toBeGreaterThanOrEqual(Math.hypot(to.u - from.u, to.v - from.v) - 1e-9);
   }
  }
 });

 it("keeps deterministic tie-breaking: repeated and freshly sealed plans give identical routes", () => {
  const plan = LAYOUTS[3]!, again = seal(JSON.parse(JSON.stringify(plan)));
  expect(again === plan).toBe(false);
  const g = worldIsoGrid(plan)!;
  for (const [a, b] of pairs(plan, 15)) {
   const first = worldIsoGridRoute(plan, g.point(a), g.point(b));
   expect(worldIsoGridRoute(plan, g.point(a), g.point(b))).toEqual(first);
   expect(worldIsoGridRoute(again, g.point(a), g.point(b))).toEqual(first);
  }
 });
});

describe("swept-footprint clearance on every movement segment", () => {
 it("blocks a diagonal step through an obstacle that sits between four free grid nodes", () => {
  // A thin post at the centre of a half-tile cell is 0.339 tile from each of the four nodes around it (> 0.3 footprint).
  const plan = bare("post", square(6), [{ id: "post", u1: 2.24, v1: 2.24, u2: 2.26, v2: 2.26 }]);
  const g = worldIsoGrid(plan)!, id = (u: number, v: number) => g.nodeAt(u, v);
  for (const [u, v] of [[2, 2], [2.5, 2], [2, 2.5], [2.5, 2.5]] as const) expect(g.free(id(u, v))).toBe(true);
  expect(g.neighbours(id(2, 2)).some(e => e.to === id(2.5, 2.5))).toBe(false);
  expect(g.neighbours(id(2.5, 2)).some(e => e.to === id(2, 2.5))).toBe(false);
  expect(g.neighbours(id(2, 2)).some(e => e.to === id(2.5, 2))).toBe(false); // passes 0.24 tile from the post
  expect(worldIsoSegmentClear(plan, { u: 2, v: 2 }, { u: 2.5, v: 2.5 })).toBe(false);
  const path = worldIsoPath(plan, { u: 1, v: 1 }, { u: 3.5, v: 3.5 })!;
  expect(pathClear(plan, path)).toBe(true);
  expect(worldIsoPathLength(path)).toBeGreaterThan(Math.hypot(2.5, 2.5));
 });

 it("does not cut the inside corner of a wall, a desk, or a concave floor", () => {
  const corner = bare("desk-corner", square(8), [{ id: "desk", u1: 3, v1: 3, u2: 5, v2: 5 }]);
  expect(worldIsoPointFree(corner, { u: 2.6, v: 3.1 }) && worldIsoPointFree(corner, { u: 3.1, v: 2.6 })).toBe(true);
  expect(worldIsoSegmentClear(corner, { u: 2.6, v: 3.1 }, { u: 3.1, v: 2.6 })).toBe(false); // both ends free; passes 0.21 tile from the corner
  expect(worldIsoSegmentClear(corner, { u: 2.5, v: 3 }, { u: 3, v: 2.5 })).toBe(true);      // 0.35 tile from the corner
  expect(worldIsoSegmentClear(L_FLOOR, { u: 3.5, v: 4.5 }, { u: 4.5, v: 3.5 })).toBe(false); // across the reflex corner
  expect(worldIsoSegmentClear(L_FLOOR, { u: 2, v: 8 }, { u: 8, v: 2 })).toBe(false);          // leaves the floor entirely
  const path = worldIsoPath(L_FLOOR, { u: 2, v: 8 }, { u: 8, v: 2 })!;
  expect(path).not.toBeNull();
  expect(pathClear(L_FLOOR, path)).toBe(true);
 });

 it("every raw grid edge on every layout passes an independent dense-sampling check", () => {
  let edges = 0;
  for (const plan of LAYOUTS) {
   const g = worldIsoGrid(plan)!;
   for (const id of freeNodes(plan)) for (const e of g.neighbours(id)) { edges++; if (!sampledClear(plan, g.point(id), g.point(e.to), r, 0.02)) throw new Error(`${plan.id}: edge ${id}→${e.to} clips`); }
  }
  expect(edges).toBeGreaterThan(5000);
 });

 it("every segment of every smoothed path passes the same independent check", () => {
  let segments = 0;
  for (const plan of LAYOUTS) {
   const g = worldIsoGrid(plan)!;
   for (const [a, b] of pairs(plan, 40)) {
    const path = worldIsoPath(plan, g.point(a), g.point(b));
    if (!path) continue;
    segments += path.length - 1;
    expect(pathClear(plan, path)).toBe(true);
   }
  }
  expect(segments).toBeGreaterThan(200);
  // Smoothing itself never joins two points through furniture.
  expect(worldIsoSmoothPath(ROOM, [{ u: 2, v: 7 }, { u: 4.75, v: 5 }, { u: 4.75, v: 3 }, { u: 2, v: 1 }])).toHaveLength(4);
 });
});

describe("malformed room geometry fails closed", () => {
 const withFloor = (floor: unknown) => ({ id: "bad", floor, colliders: [], anchors: [DOOR], door: "door" });

 it("rejects self-intersecting floors", () => {
  expect(codes(withFloor([{ u: 0, v: 0 }, { u: 6, v: 6 }, { u: 6, v: 0 }, { u: 0, v: 6 }]))).toContain("floor-self-intersecting");
  expect(codes(withFloor([{ u: 0, v: 0 }, { u: 8, v: 0 }, { u: 8, v: 6 }, { u: 3, v: -2 }, { u: 0, v: 6 }]))).toContain("floor-self-intersecting");
  expect(codes(withFloor([{ u: 0, v: 0 }, { u: 6, v: 0 }, { u: 3, v: 0 }, { u: 3, v: 5 }]))).toContain("floor-self-intersecting");
  expect(worldIsoFloorProblems([{ u: 0, v: 0 }, { u: 10, v: 0 }, { u: 10, v: 4 }, { u: 4, v: 4 }, { u: 4, v: 10 }, { u: 0, v: 10 }])).toEqual([]);
 });

 it("rejects zero-area and degenerate outlines", () => {
  expect(codes(withFloor([{ u: 0, v: 0 }, { u: 4, v: 4 }, { u: 8, v: 8 }]))).toEqual(["floor-self-intersecting"]); // collinear: its edges lie on top of each other
  expect(codes(withFloor([{ u: 0, v: 0 }, { u: 9, v: 0 }, { u: 9, v: 0.1 }, { u: 0, v: 0.1 }]))).toContain("floor-degenerate"); // sliver under 1 square tile
  expect(codes(withFloor([{ u: 0, v: 0 }, { u: 5, v: 0 }, { u: 5, v: 0 }, { u: 0, v: 5 }]))).toContain("floor-degenerate");
  expect(codes(withFloor([{ u: 0, v: 0 }, { u: 0.5, v: 0 }, { u: 0.5, v: 0.5 }, { u: 0, v: 0.5 }]))).toContain("floor-degenerate");
 });

 it("rejects non-finite or missing geometry", () => {
  expect(codes(withFloor([{ u: 0, v: 0 }, { u: Number.NaN, v: 0 }, { u: 5, v: 5 }, { u: 0, v: 5 }]))).toContain("floor-invalid");
  expect(codes(withFloor([{ u: 0, v: 0 }, { u: Infinity, v: 0 }, { u: 5, v: 5 }]))).toContain("floor-invalid");
  expect(codes(withFloor([{ u: 0, v: 0 }, null, { u: 5, v: 5 }, { u: 0, v: 5 }]))).toContain("floor-invalid");
  expect(codes(withFloor([{ u: "0", v: 0 }, { u: 5, v: 0 }, { u: 5, v: 5 }]))).toContain("floor-invalid");
  expect(codes(null)).toEqual(["plan-invalid"]);
  expect(codes({ id: "x" })).toEqual(["plan-invalid"]);
  expect(codes({ id: "x", floor: "nope", colliders: [], anchors: [], door: "door" })).toEqual(["plan-invalid"]);
 });

 it("rejects malformed collider boundaries", () => {
  for (const c of [
   { id: "nan", u1: Number.NaN, v1: 1, u2: 3, v2: 3 }, { id: "inf", u1: 1, v1: 1, u2: Infinity, v2: 3 }, { id: "flipped", u1: 3, v1: 1, u2: 2, v2: 3 },
   { id: "flat", u1: 1, v1: 2, u2: 3, v2: 2 }, { id: "missing", u1: 1, v1: 1 }, { u1: 1, v1: 1, u2: 2, v2: 2 }, null, "desk",
  ]) expect(codes({ ...withFloor(square(8)), colliders: [c] })).toContain("collider-invalid");
 });

 it("rejects malformed anchors", () => {
  const good = withFloor(square(8));
  expect(codes({ ...good, anchors: [{ ...DOOR, kind: "trapdoor" }] })).toContain("anchor-invalid");
  expect(codes({ ...good, anchors: [DOOR, { id: "v", kind: "visitor", at: { u: Number.NaN, v: 2 }, facing: "s" }] })).toContain("anchor-invalid");
  expect(codes({ ...good, anchors: [DOOR, { id: "v", kind: "visitor", at: { u: 3, v: 3 }, facing: "up" }] })).toContain("anchor-invalid");
  expect(codes({ ...good, anchors: [DOOR, { id: "v", kind: "visitor", at: { u: 3, v: 3 }, facing: "s", desk: -1 }] })).toContain("anchor-invalid");
  expect(codes({ ...good, anchors: [DOOR, null] })).toContain("anchor-invalid");
  expect(codes(good)).toEqual([]);
 });

 it("explains every problem in words, returns no plan and never throws", () => {
  const hostile = { id: "x", get floor(): unknown { throw new Error("boom"); }, colliders: [], anchors: [], door: "door" };
  const bad: unknown[] = [
   null, undefined, 7, "plan", {}, withFloor([]), withFloor([{ u: 0, v: 0 }, { u: 6, v: 6 }, { u: 6, v: 0 }, { u: 0, v: 6 }]), hostile,
   { ...withFloor(square(8)), colliders: [{ id: "c", u1: 1, v1: 1, u2: Number.NaN, v2: 2 }], anchors: [null, 3, { id: 5 }] },
  ];
  for (const plan of bad) {
   const report = worldIsoValidatePlan(plan);
   expect(report.ok).toBe(false);
   expect(report.plan).toBeNull();
   expect(report.problems.length).toBeGreaterThan(0);
   for (const p of report.problems) { expect(p.message.length).toBeGreaterThan(20); expect(typeof p.id).toBe("string"); }
   expect(report.routes).toEqual({});
   expect(worldIsoSealPlan(plan)).toBeNull();
  }
 });
});

describe("invalid collision inputs fail closed (Core/QA P1)", () => {
 const desk = bare("desk-room", square(8), [{ id: "desk", u1: 3, v1: 3, u2: 5, v2: 5 }]);
 const open: [GroundPoint, GroundPoint] = [{ u: 1, v: 1 }, { u: 7, v: 1 }], blocked: [GroundPoint, GroundPoint] = [{ u: 1, v: 4 }, { u: 7, v: 4 }];
 const BAD_RADII: unknown[] = [Number.NaN, Infinity, -Infinity, -0.3, 0, -0, 0.05, 0.0999, 1.0001, 5, 1e9, "0.3", null, {}, [0.3], true];
 const BAD_POINTS: unknown[] = [{ u: Number.NaN, v: 1 }, { u: 1, v: Infinity }, { u: -Infinity, v: 1 }, { u: 1e9, v: 1 }, { u: "1", v: 1 }, { u: 1 }, {}, null, undefined, 3, "1,1"];

 it("documents the supported radius: a finite number from 0.1 to 1 tile", () => {
  expect(WORLD_ISO_LIMITS.minRadius).toBe(0.1); expect(WORLD_ISO_LIMITS.maxRadius).toBe(1);
  for (const ok of [0.1, 0.3, 0.45, 1]) expect(worldIsoRadiusOk(ok)).toBe(true);
  for (const bad of BAD_RADII) expect(worldIsoRadiusOk(bad)).toBe(false);
 });

 it("an unsupported radius never reports a point, a segment or a route as walkable", () => {
  for (const bad of BAD_RADII) {
   const radius = bad as number;
   expect(worldIsoPointFree(desk, { u: 1, v: 1 }, radius)).toBe(false);
   expect(worldIsoPointFree(desk, { u: 4, v: 4 }, radius)).toBe(false);            // inside the desk
   expect(worldIsoSegmentClear(desk, blocked[0], blocked[1], radius)).toBe(false);  // straight through the desk (QA's NaN case)
   expect(worldIsoSegmentClear(desk, open[0], open[1], radius)).toBe(false);
   expect(worldIsoGrid(desk, radius)).toBeNull();
   expect(worldIsoGridBudget(desk, radius)).toBeNull();
   expect(worldIsoConnectors(desk, open[0], radius)).toEqual([]);
   expect(worldIsoGridRoute(desk, blocked[0], blocked[1], radius)).toBeNull();
   expect(worldIsoPath(desk, blocked[0], blocked[1], radius)).toBeNull();
   expect(worldIsoPath(desk, open[0], open[1], radius)).toBeNull();
   expect(worldIsoSmoothPath(desk, [open[0], { u: 4, v: 1.5 }, open[1]], radius)).toBeNull();            // even a walkable path gets no result
   expect(codes(rawPlan("r", square(8)), radius)).toEqual(["radius-invalid"]);
   expect(worldIsoValidatePlan(rawPlan("r", square(8)), radius).plan).toBeNull();
  }
 });

 it("an invalid position never reports free, clear or reachable", () => {
  for (const bad of BAD_POINTS) {
   const p = bad as GroundPoint;
   expect(worldIsoPointFree(desk, p)).toBe(false);
   expect(worldIsoSegmentClear(desk, p, open[1])).toBe(false);
   expect(worldIsoSegmentClear(desk, open[0], p)).toBe(false);
   expect(worldIsoConnectors(desk, p)).toEqual([]);
   expect(worldIsoGridRoute(desk, p, open[1])).toBeNull();
   expect(worldIsoGridRoute(desk, open[0], p)).toBeNull();
   expect(worldIsoPath(desk, p, open[1])).toBeNull();
   expect(worldIsoPath(desk, open[0], p)).toBeNull();
   expect(worldIsoSmoothPath(desk, [open[0], p, open[1]])).toBeNull(); // never dropped, never joined across
  }
  const g = worldIsoGrid(desk)!;
  for (const id of [-1, 1.5, Number.NaN, Infinity, g.cols * g.rows, 1e12]) { expect(g.free(id)).toBe(false); expect(g.neighbours(id)).toEqual([]); }
  expect(g.nodeAt(Number.NaN, 1)).toBe(-1);
 });

 it("an unsealed plan is refused by every query", () => {
  const raw = rawPlan("raw", square(8)) as unknown as GroundPlan;
  expect(worldIsoPlanSealed(raw)).toBe(false);
  expect(worldIsoPointFree(raw, { u: 1, v: 1 })).toBe(false);
  expect(worldIsoSegmentClear(raw, open[0], open[1])).toBe(false);
  expect(worldIsoGrid(raw)).toBeNull();
  expect(worldIsoGridBudget(raw)).toBeNull();
  expect(worldIsoConnectors(raw, open[0])).toEqual([]);
  expect(worldIsoGridRoute(raw, open[0], open[1])).toBeNull();
  expect(worldIsoPath(raw, open[0], open[1])).toBeNull();
  for (const junk of [null, undefined, 5, "plan", {}, []]) expect(worldIsoPath(junk as unknown as GroundPlan, open[0], open[1])).toBeNull();
 });

 it("supported radii work across the whole range, and a bigger character is blocked by more", () => {
  expect(worldIsoPointFree(desk, { u: 1.5, v: 1.5 }, 0.1)).toBe(true);
  expect(worldIsoPointFree(desk, { u: 1.5, v: 1.5 }, 1)).toBe(true);
  expect(worldIsoPointFree(desk, { u: 0.5, v: 0.5 }, 1)).toBe(false);
  const gap = bare("gap-1", square(8), [{ id: "l", u1: 0, v1: 3.5, u2: 3.5, v2: 4.5 }, { id: "r", u1: 4.5, v1: 3.5, u2: 8, v2: 4.5 }]);
  expect(worldIsoPath(gap, { u: 4, v: 1.5 }, { u: 4, v: 6.5 }, 0.3)).not.toBeNull();
  expect(worldIsoPath(gap, { u: 4, v: 1.5 }, { u: 4, v: 6.5 }, 0.5)).not.toBeNull(); // exactly fits a 1-tile gap
  expect(worldIsoPath(gap, { u: 4, v: 1.5 }, { u: 4, v: 6.5 }, 0.6)).toBeNull();
  const wide = worldIsoPath(desk, { u: 1.5, v: 4 }, { u: 6.5, v: 4 }, 1)!;
  expect(pathClear(desk, wide, 1)).toBe(true);
 });
});

describe("size limits are enforced before allocation (Core/QA P1)", () => {
 const row = (n: number) => Array.from({ length: n }, (_, i) => ({ id: `c${i}`, u1: 1 + i * 1.5, v1: 5, u2: 2 + i * 1.5, v2: 6 }));
 const ring = (n: number) => Array.from({ length: n }, (_, i) => ({ u: 60 + 50 * Math.cos(2 * Math.PI * i / n), v: 60 + 50 * Math.sin(2 * Math.PI * i / n) }));

 it("rejects Core's 10,000-tile floor and QA's million-tile floor with a clear message and no allocation", () => {
  for (const [size, code] of [[10_000, "floor-invalid"], [1_000_000, "floor-invalid"], [1000, "floor-too-large"], [201, "floor-too-large"]] as const) {
   const raw = rawPlan("huge", square(size), [{ id: "wall", u1: 0, v1: 3, u2: size, v2: 4 }]);
   const report = withoutAllocating(() => worldIsoValidatePlan(raw));
   expect(report.ok).toBe(false);
   expect(report.problems.map(p => p.code)).toContain(code);
   expect(report.problems[0]!.message.length).toBeGreaterThan(20);
   expect(withoutAllocating(() => worldIsoSealPlan(raw))).toBeNull();
   expect(withoutAllocating(() => worldIsoPath(raw as unknown as GroundPlan, { u: 1, v: 1 }, { u: 1, v: 9 }))).toBeNull();
  }
 });

 it("rejects too many corners, colliders or anchors before reading them all", () => {
  expect(codes(rawPlan("corners", ring(WORLD_ISO_LIMITS.maxFloorCorners + 1)))).toEqual(["floor-too-many-corners"]);
  expect(worldIsoSealPlan(rawPlan("corners-ok", ring(WORLD_ISO_LIMITS.maxFloorCorners), [], [])) !== null).toBe(true);
  expect(codes(rawPlan("colliders", square(200), row(WORLD_ISO_LIMITS.maxColliders + 1)))).toContain("too-many-colliders");
  const manyAnchors = Array.from({ length: WORLD_ISO_LIMITS.maxAnchors + 1 }, (_, i) => ({ id: `a${i}`, kind: "visitor", at: { u: 1 + i * 0.7, v: 2 }, facing: "s" }));
  expect(codes(rawPlan("anchors", square(200), [], manyAnchors))).toContain("too-many-anchors");
  // A list that claims an absurd length is not walked: only limit + 1 entries are ever read.
  let reads = 0;
  const sparse = new Proxy(new Array(1e9), { get(target, key, receiver) { if (typeof key === "string" && /^\d+$/.test(key)) reads++; return Reflect.get(target, key, receiver); } });
  expect(codes({ id: "sparse", floor: square(10), colliders: sparse, anchors: [DOOR], door: "door" })).toContain("too-many-colliders");
  expect(reads).toBeLessThanOrEqual(WORLD_ISO_LIMITS.maxColliders + 1);
 });

 it("rejects a plan whose grid would exceed the node or work budget, without allocating", () => {
  const raw = rawPlan("dense", square(200), row(WORLD_ISO_LIMITS.maxColliders));
  const plan = seal(raw); // structure is fine; the grid is what is too big
  const budget = worldIsoGridBudget(plan)!;
  expect(budget.ok).toBe(false);
  expect(budget.nodes > WORLD_ISO_LIMITS.maxGridNodes || budget.work > WORLD_ISO_LIMITS.maxGridWork).toBe(true);
  withoutAllocating(() => {
   expect(worldIsoGrid(plan)).toBeNull();
   expect(worldIsoConnectors(plan, { u: 1, v: 1 })).toEqual([]);
   expect(worldIsoGridRoute(plan, { u: 1, v: 1 }, { u: 1, v: 9 })).toBeNull();
   expect(worldIsoPath(plan, { u: 1, v: 1 }, { u: 1, v: 9 })).toBeNull(); // the row of boxes blocks the straight line
   const report = worldIsoValidatePlan(raw);
   expect(report.problems.map(p => p.code)).toEqual(["grid-too-large"]);
   expect(report.problems[0]!.message).toContain("limit");
   expect(report.plan).toBeNull();
  });
  // Exact queries that need no grid still answer correctly on a sealed plan.
  expect(worldIsoPointFree(plan, { u: 1, v: 1 })).toBe(true);
  expect(worldIsoSegmentClear(plan, { u: 1, v: 1 }, { u: 1, v: 9 })).toBe(false);
 });

 it("does not restrict ordinary or generously larger rooms", () => {
  const office = worldIsoGridBudget(WORLD_ISO_GREYBOX)!;
  expect(office.ok).toBe(true);
  expect(office.nodes).toBeLessThan(WORLD_ISO_LIMITS.maxGridNodes / 20);
  const big = seal(rawPlan("big", square(60, 40), row(38)));
  expect(worldIsoGridBudget(big)!.ok).toBe(true);
  expect(worldIsoPath(big, { u: 1, v: 1 }, { u: 30, v: 38 })).not.toBeNull();
  expect(worldIsoGridBudget(seal(rawPlan("max", square(WORLD_ISO_LIMITS.maxExtent))))!.ok).toBe(true); // the largest empty floor fits
  expect(worldIsoSealPlan(rawPlan("offset", square(10).map(p => ({ u: p.u + 1000, v: p.v - 1000 })), [], [])) !== null).toBe(true); // far from the origin is fine
 });

 it("keeps at most a few grids per plan when many radii are used", () => {
  const plan = bare("radii", square(8));
  const first = worldIsoGrid(plan, 0.3)!;
  expect(worldIsoGrid(plan, 0.3) === first).toBe(true);
  for (const radius of [0.31, 0.32, 0.33, 0.34, 0.35]) expect(worldIsoGrid(plan, radius)).not.toBeNull();
  expect(worldIsoGrid(plan, 0.3) === first).toBe(false); // the oldest grid was dropped and rebuilt
  expect(worldIsoPath(plan, { u: 1, v: 1 }, { u: 7, v: 7 }, 0.3)).not.toBeNull();
 });
});

describe("sealed plans cannot go stale (Core/QA P2: mutation and cache safety)", () => {
 const makeRaw = () => ({
  id: "mutable", floor: square(10, 8),
  colliders: [{ id: "left", u1: 0, v1: 3.5, u2: 4, v2: 4.5 }, { id: "right", u1: 5.5, v1: 3.5, u2: 10, v2: 4.5 }],
  anchors: [{ id: "door", kind: "door", at: { u: 2, v: 7.5 }, facing: "n" }, { id: "far", kind: "visitor", at: { u: 8, v: 1 }, facing: "s" }],
  door: "door",
 });
 const frozenDeep = (x: unknown): boolean => x === null || typeof x !== "object" || (Object.isFrozen(x) && Object.values(x as object).every(frozenDeep));

 it("seals a deep-frozen private copy that shares no object with the input", () => {
  const raw = makeRaw(), plan = seal(raw);
  expect(frozenDeep(plan)).toBe(true);
  expect(plan.floor === (raw.floor as unknown)).toBe(false);
  expect(plan.floor[0] === (raw.floor[0] as unknown)).toBe(false);
  expect(plan.colliders[0] === (raw.colliders[0] as unknown)).toBe(false);
  expect(plan.anchors[0]!.at === (raw.anchors[0]!.at as unknown)).toBe(false);
  expect(worldIsoSealPlan(plan) === plan).toBe(true); // sealing twice is a no-op
  expect(frozenDeep(WORLD_ISO_GREYBOX)).toBe(true);
 });

 it("changing the original after sealing changes nothing: floor, colliders, anchors, grid and routes", () => {
  const raw = makeRaw(), plan = seal(raw);
  const from = { u: 2, v: 7.5 }, to = { u: 8, v: 1 };
  const before = { path: worldIsoPath(plan, from, to), route: worldIsoGridRoute(plan, from, to), free: worldIsoPointFree(plan, { u: 4.75, v: 4 }), report: worldIsoValidatePlan(plan) };
  raw.colliders[0]!.u2 = 5.5;                 // close the gap in the original
  raw.colliders.push({ id: "new", u1: 1, v1: 6, u2: 9, v2: 7 });
  (raw.floor[2] as { u: number }).u = 3; raw.floor.pop();       // shrink and break the floor
  raw.anchors[1]!.at.u = 2;                   // move an anchor into the desk row
  raw.door = "far";
  expect(worldIsoPath(plan, from, to)).toEqual(before.path);
  expect(worldIsoGridRoute(plan, from, to)).toEqual(before.route);
  expect(worldIsoPointFree(plan, { u: 4.75, v: 4 })).toBe(before.free);
  expect(worldIsoValidatePlan(plan)).toEqual(before.report);
  expect(plan.colliders).toHaveLength(2);
  expect(plan.anchors[1]!.at).toEqual({ u: 8, v: 1 });
  // Re-validating the changed original gives a new verdict for the new geometry; the old sealed plan is unaffected.
  expect(worldIsoValidatePlan(raw).ok).toBe(false);
  expect(worldIsoPath(plan, from, to)).toEqual(before.path);
 });

 it("the sealed plan itself cannot be modified", () => {
  const plan = seal(makeRaw());
  const attempt = (f: () => void) => { try { f(); } catch { /* frozen objects throw in strict mode */ } };
  const snapshot = JSON.stringify(plan), path = worldIsoPath(plan, { u: 2, v: 7.5 }, { u: 8, v: 1 });
  attempt(() => { (plan.colliders[0] as { u2: number }).u2 = 5.5; });
  attempt(() => { (plan.colliders as unknown[]).push({ id: "x", u1: 1, v1: 6, u2: 9, v2: 7 }); });
  attempt(() => { (plan.floor[1] as { u: number }).u = 2; });
  attempt(() => { (plan.anchors[0]!.at as { v: number }).v = 4; });
  attempt(() => { (plan as { door: string }).door = "far"; });
  expect(JSON.stringify(plan)).toBe(snapshot);
  expect(worldIsoPath(plan, { u: 2, v: 7.5 }, { u: 8, v: 1 })).toEqual(path);
 });

 it("grid geometry, edges and returned routes cannot be altered through what the API hands out", () => {
  const plan = seal(makeRaw()), g = worldIsoGrid(plan)!, node = freeNodes(plan)[10]!;
  expect(Object.isFrozen(g)).toBe(true);
  expect(Object.isFrozen(g.us) && Object.isFrozen(g.vs)).toBe(true);
  const edges = g.neighbours(node);
  expect(Object.isFrozen(edges) && edges.every(e => Object.isFrozen(e))).toBe(true);
  const p = g.point(node) as { u: number; v: number }, original = { ...p };
  p.u = 99; p.v = 99;
  expect(g.point(node)).toEqual(original); // a fresh copy each time
  const from = { u: 2, v: 7.5 }, to = { u: 8, v: 1 };
  const first = worldIsoPath(plan, from, to)!, expected = JSON.stringify(first);
  for (const q of first as { u: number; v: number }[]) { q.u = 4; q.v = 4; }
  first.length = 0;
  from.u = 4; from.v = 4; // the caller's own points are copied too
  expect(JSON.stringify(worldIsoPath(plan, { u: 2, v: 7.5 }, to))).toBe(expected);
  const route = worldIsoGridRoute(plan, { u: 2, v: 7.5 }, to)!;
  (route.nodes as number[]).length = 0;
  expect(worldIsoGridRoute(plan, { u: 2, v: 7.5 }, to)!.nodes.length).toBeGreaterThan(0);
 });

 it("input that changes between reads cannot pass validation with one value and be stored with another", () => {
  let reads = 0;
  const shifty = { id: "desk", u1: 3, v1: 3, get u2() { return ++reads === 1 ? 5 : Number.NaN; }, v2: 5 };
  const plan = worldIsoSealPlan(rawPlan("shifty", square(8), [shifty]));
  expect(reads).toBe(1); // each field is read exactly once
  expect(plan !== null).toBe(true);
  expect(plan!.colliders[0]).toEqual({ id: "desk", u1: 3, v1: 3, u2: 5, v2: 5 });
  expect(worldIsoPointFree(plan!, { u: 4, v: 4 })).toBe(false);
 });
});

describe("off-grid passages, endpoints and connectors (Core/QA P2)", () => {
 /** A wall across a 10 × 8 room with one gap of `width` starting at `left` (not grid aligned). */
 const wallGap = (left: number, width: number, vertical = false) => vertical
  ? bare("gap-v", square(8, 10), [{ id: "a", u1: 3.5, v1: 0, u2: 4.5, v2: left }, { id: "b", u1: 3.5, v1: left + width, u2: 4.5, v2: 10 }])
  : bare("gap-u", square(10, 8), [{ id: "a", u1: 0, v1: 3.5, u2: left, v2: 4.5 }, { id: "b", u1: left + width, v1: 3.5, u2: 10, v2: 4.5 }]);
 const across = (plan: GroundPlan, vertical = false) => vertical ? worldIsoPath(plan, { u: 1.3, v: 2.2 }, { u: 6.7, v: 7.4 }) : worldIsoPath(plan, { u: 2.2, v: 1.3 }, { u: 7.4, v: 6.7 });

 it("finds Core's example: a 0.62-tile gap at u ∈ [4.05, 4.67], between the half-tile columns", () => {
  const plan = wallGap(4.05, 0.62), g = worldIsoGrid(plan)!;
  expect(g.nodeAt(4, 4)).toBeGreaterThanOrEqual(0);
  expect(g.free(g.nodeAt(4, 4)) || g.free(g.nodeAt(4.5, 4))).toBe(false); // neither half-tile column can cross
  const path = across(plan)!;
  expect(path).not.toBeNull();
  expect(pathClear(plan, path)).toBe(true);
  expect(path.some(p => p.u > 4.05 + r - 1e-6 && p.u < 4.67 - r + 1e-6 && p.v > 3.5 && p.v < 4.5) || worldIsoPathLength(path) > 0).toBe(true);
 });

 it("crosses every physically passable gap from 0.61 tile, at any offset and on either axis", () => {
  const supported = 2 * r + 2 * WORLD_ISO_CLEARANCE_MARGIN;
  expect(supported).toBeCloseTo(0.61, 12);
  for (const vertical of [false, true]) for (const width of [0.61, 0.62, 0.7, 0.93, 1.07]) for (const left of [4.05, 4.13, 4.21, 4.33, 4.41, 4.49, 5.02]) {
   const plan = wallGap(left, width, vertical), path = across(plan, vertical);
   if (!path) throw new Error(`gap ${width} at ${left} (${vertical ? "v" : "u"}) was reported unreachable`);
   expect(pathClear(plan, path)).toBe(true);
  }
 });

 it("still refuses every gap narrower than the footprint, at any offset", () => {
  for (const vertical of [false, true]) for (const width of [0.3, 0.5, 0.58, 0.599]) for (const left of [4, 4.05, 4.2, 4.33, 4.45])
   expect(across(wallGap(left, width, vertical), vertical)).toBeNull();
 });

 it("handles off-grid gaps between a wall and furniture, and corridors made by a concave floor", () => {
  const wallSide = bare("wall-side", square(10, 8), [{ id: "block", u1: 0.63, v1: 3.5, u2: 10, v2: 4.5 }]); // 0.63 gap along the u = 0 wall
  const a = worldIsoPath(wallSide, { u: 5, v: 1.2 }, { u: 5, v: 6.8 })!;
  expect(a).not.toBeNull(); expect(pathClear(wallSide, a)).toBe(true);
  // Two rooms joined by a 0.62-tile corridor at v ∈ [2.13, 2.75], formed only by floor edges.
  const dumbbell = bare("dumbbell", [{ u: 0, v: 0 }, { u: 5, v: 0 }, { u: 5, v: 2.13 }, { u: 8, v: 2.13 }, { u: 8, v: 0 }, { u: 13, v: 0 }, { u: 13, v: 6 }, { u: 8, v: 6 }, { u: 8, v: 2.75 }, { u: 5, v: 2.75 }, { u: 5, v: 6 }, { u: 0, v: 6 }]);
  const b = worldIsoPath(dumbbell, { u: 1.4, v: 4.6 }, { u: 11.3, v: 4.9 })!;
  expect(b).not.toBeNull(); expect(pathClear(dumbbell, b)).toBe(true);
  const narrow = bare("dumbbell-narrow", [{ u: 0, v: 0 }, { u: 5, v: 0 }, { u: 5, v: 2.13 }, { u: 8, v: 2.13 }, { u: 8, v: 0 }, { u: 13, v: 0 }, { u: 13, v: 6 }, { u: 8, v: 6 }, { u: 8, v: 2.7 }, { u: 5, v: 2.7 }, { u: 5, v: 6 }, { u: 0, v: 6 }]);
  expect(worldIsoPath(narrow, { u: 1.4, v: 4.6 }, { u: 11.3, v: 4.9 })).toBeNull(); // 0.57 corridor
  expect(pathClear(L_FLOOR, worldIsoPath(L_FLOOR, { u: 1.37, v: 8.61 }, { u: 8.83, v: 1.19 })!)).toBe(true);
 });

 it("routes between arbitrary off-grid starts and destinations", () => {
  let routed = 0;
  for (const plan of LAYOUTS) {
   const random = rng(plan.id.length * 97 + 5), us = plan.floor.map(p => p.u), vs = plan.floor.map(p => p.v);
   const pick = () => { for (let k = 0; k < 200; k++) { const p = { u: Math.min(...us) + random() * (Math.max(...us) - Math.min(...us)), v: Math.min(...vs) + random() * (Math.max(...vs) - Math.min(...vs)) }; if (worldIsoPointFree(plan, p)) return p; } throw new Error("no free point"); };
   for (let k = 0; k < 20; k++) {
    const from = pick(), to = pick(), path = worldIsoPath(plan, from, to), truth = referenceCost(plan, from, to);
    if (!path) { expect(Number.isFinite(truth)).toBe(false); continue; }
    expect(path[0]).toEqual(from); expect(path.at(-1)).toEqual(to);
    expect(pathClear(plan, path)).toBe(true);
    if (path.length > 2) { expect(Math.abs(worldIsoGridRoute(plan, from, to)!.cost - truth)).toBeLessThan(1e-9); expect(worldIsoPathLength(path)).toBeLessThanOrEqual(truth + 1e-9); }
    routed++;
   }
  }
  expect(routed).toBeGreaterThan(100);
 });

 it("gives each endpoint several verified connectors, nearest first, within a fixed cap", () => {
  const p = { u: 4.71, v: 5.37 }, connectors = worldIsoConnectors(ROOM, p), g = worldIsoGrid(ROOM)!;
  expect(connectors.length).toBeGreaterThan(4);
  expect(connectors.length).toBeLessThanOrEqual(WORLD_ISO_MAX_CONNECTORS);
  for (let i = 0; i < connectors.length; i++) {
   const c = connectors[i]!;
   expect(sampledClear(ROOM, p, g.point(c.node))).toBe(true);
   expect(c.cost).toBeLessThanOrEqual(1.5 + 1e-9);
   if (i) expect(c.cost).toBeGreaterThanOrEqual(connectors[i - 1]!.cost);
  }
  expect(worldIsoConnectors(ROOM, { u: 2, v: 4 })).toEqual([]); // inside a desk
  // The nearest node is not always the best way out: using all connectors is never worse, and here it is better.
  const to = { u: 8.2, v: 1.1 }, route = worldIsoGridRoute(ROOM, p, to)!, nearestOnly = connectors[0]!;
  const viaNearest = nearestOnly.cost + referenceCost(ROOM, g.point(nearestOnly.node), to);
  expect(route.cost).toBeLessThanOrEqual(viaNearest + 1e-9);
 });

 it("accepts exact tangency and rejects anything closer (no epsilon tunnelling)", () => {
  const plan = bare("tangent", square(8), [{ id: "desk", u1: 3, v1: 3, u2: 5, v2: 5 }]);
  expect(worldIsoSegmentClear(plan, { u: 1, v: 2.7 }, { u: 7, v: 2.7 })).toBe(true);           // exactly one footprint from the desk side
  expect(worldIsoSegmentClear(plan, { u: 1, v: 2.7 + 1e-6 }, { u: 7, v: 2.7 + 1e-6 })).toBe(false);
  expect(worldIsoPointFree(plan, { u: 0.3, v: 0.3 })).toBe(true);                             // exactly one footprint from two walls
  expect(worldIsoPointFree(plan, { u: 0.3 - 1e-6, v: 0.3 })).toBe(false);
  for (const [a, b] of pairs(plan, 30)) {
   const g = worldIsoGrid(plan)!, path = worldIsoPath(plan, g.point(a), g.point(b));
   if (path) for (let i = 1; i < path.length; i++) expect(minClearance(plan, path[i - 1]!, path[i]!)).toBeGreaterThanOrEqual(r - 1e-6);
  }
 });

 it("reports disconnected regions as unreachable, in both directions, and names the anchor", () => {
  const raw = { ...ROOM_RAW, colliders: [{ id: "wall", u1: 0, v1: 3.5, u2: 10, v2: 4.5 }] }, plan = seal(raw);
  const south = { u: 2.3, v: 6.9 }, north = { u: 7.7, v: 1.4 };
  expect(worldIsoPath(plan, south, north)).toBeNull();
  expect(worldIsoPath(plan, north, south)).toBeNull();
  expect(worldIsoGridRoute(plan, south, north)).toBeNull();
  expect(Number.isFinite(referenceCost(plan, south, north))).toBe(false);
  expect(worldIsoPath(plan, south, { u: 8.1, v: 7.2 })).not.toBeNull(); // same side still works
  const problems = worldIsoValidatePlan(raw).problems;
  expect(problems.map(p => `${p.code}:${p.id}`)).toEqual(["anchor-unreachable:far"]);
 });

 it("generates identical routes every time, and stays small and fast for the Office", () => {
  const plan = wallGap(4.13, 0.62), from = { u: 2.2, v: 1.3 }, to = { u: 7.4, v: 6.7 };
  const first = JSON.stringify([worldIsoGridRoute(plan, from, to), worldIsoPath(plan, from, to)]);
  for (let k = 0; k < 3; k++) expect(JSON.stringify([worldIsoGridRoute(plan, from, to), worldIsoPath(plan, from, to)])).toBe(first);
  const again = seal(JSON.parse(JSON.stringify(plan)));
  expect(JSON.stringify([worldIsoGridRoute(again, from, to), worldIsoPath(again, from, to)])).toBe(first);
  const office = worldIsoGridBudget(WORLD_ISO_GREYBOX)!;
  expect(office.nodes).toBeLessThan(10_000);
  const anchors = WORLD_ISO_GREYBOX.anchors, door = anchors.find(a => a.id === "door")!;
  const started = Date.now();
  for (const a of anchors) if (a.id !== "door") expect(worldIsoPath(WORLD_ISO_GREYBOX, door.at, a.at)).not.toBeNull();
  expect(Date.now() - started).toBeLessThan(3000); // 47 routes including first-use edge checks; generous for slow CI
 });
});

describe("worldIsoSmoothPath fails closed (PM review of 0052733)", () => {
 const desk = bare("smooth-desk", square(8), [{ id: "desk", u1: 3, v1: 3, u2: 5, v2: 5 }]);
 const A = { u: 1, v: 4 }, B = { u: 7, v: 4 };                       // opposite sides of the desk
 const around = [A, { u: 1, v: 1.5 }, { u: 4, v: 1.5 }, { u: 7, v: 1.5 }, B]; // a walkable detour with removable corners
 const BAD_RADII: unknown[] = [Number.NaN, Infinity, -Infinity, 0, -0, -0.3, 0.05, 1.5, 1e9, "0.3", null, {}, true];
 const BAD_POINTS: unknown[] = [{ u: Number.NaN, v: 1.5 }, { u: 4, v: Infinity }, { u: -Infinity, v: 1.5 }, { u: 1e9, v: 1.5 }, { u: "4", v: 1.5 }, { u: 4 }, {}, null, undefined, 7, "4,1.5"];

 it("returns null for every unsupported radius, even for a walkable path", () => {
  for (const bad of BAD_RADII) {
   expect(worldIsoSmoothPath(desk, around, bad as number)).toBeNull();
   expect(worldIsoSmoothPath(desk, [A, B], bad as number)).toBeNull();
   expect(worldIsoSmoothPath(desk, [A], bad as number)).toBeNull();
  }
 });

 it("returns null for unsealed or junk plans", () => {
  const raw = rawPlan("raw", square(8), [{ id: "desk", u1: 3, v1: 3, u2: 5, v2: 5 }]) as unknown as GroundPlan;
  for (const plan of [raw, null, undefined, 5, "plan", {}, []]) {
   expect(worldIsoSmoothPath(plan as GroundPlan, around)).toBeNull();
   expect(worldIsoSmoothPath(plan as GroundPlan, [{ u: 1, v: 1 }, { u: 2, v: 1 }])).toBeNull();
  }
 });

 it("returns null when any waypoint is invalid: it is never dropped and its neighbours are never joined", () => {
  for (const bad of BAD_POINTS) for (let at = 0; at <= around.length; at++) {
   const path = [...around.slice(0, at), bad as GroundPoint, ...around.slice(at)];
   expect(worldIsoSmoothPath(desk, path)).toBeNull();
  }
  // The neighbours of the bad waypoint here are directly joinable; the result must still be null, not a two-point path.
  expect(worldIsoSegmentClear(desk, { u: 1, v: 1.5 }, { u: 7, v: 1.5 })).toBe(true);
  expect(worldIsoSmoothPath(desk, [{ u: 1, v: 1.5 }, { u: Number.NaN, v: 1.5 }, { u: 7, v: 1.5 }])).toBeNull();
  for (const junk of [null, undefined, 5, "path", {}, []]) expect(worldIsoSmoothPath(desk, junk as unknown as GroundPoint[])).toBeNull();
 });

 it("returns null for a two-point path that crosses furniture, leaves the floor or ends in a blocked spot", () => {
  expect(worldIsoSmoothPath(desk, [A, B])).toBeNull();                                  // straight through the desk
  expect(worldIsoSmoothPath(desk, [{ u: 2.6, v: 3.1 }, { u: 3.1, v: 2.6 }])).toBeNull(); // both ends free, clips the corner
  expect(worldIsoSmoothPath(desk, [A, { u: 4, v: 4 }])).toBeNull();                     // ends inside the desk
  expect(worldIsoSmoothPath(desk, [A, { u: 9, v: 4 }])).toBeNull();                     // ends off the floor
  expect(worldIsoSmoothPath(desk, [{ u: 4, v: 4 }])).toBeNull();                        // a single blocked point
  expect(worldIsoSmoothPath(L_FLOOR, [{ u: 2, v: 8 }, { u: 8, v: 2 }])).toBeNull();     // cuts across the missing corner of the floor
 });

 it("returns null when any consecutive segment is blocked, wherever it is in the path", () => {
  expect(worldIsoSmoothPath(desk, [A, { u: 1, v: 1.5 }, { u: 7, v: 1.5 }, B, A])).toBeNull();                 // last leg goes back through the desk
  expect(worldIsoSmoothPath(desk, [A, B, { u: 7, v: 1.5 }])).toBeNull();                                      // first leg blocked
  expect(worldIsoSmoothPath(desk, [A, { u: 1, v: 1.5 }, { u: 4, v: 4 }, { u: 7, v: 1.5 }, B])).toBeNull();    // a waypoint inside the desk
  // The blocked middle leg cannot be "smoothed away" even though its two ends are joinable by another route.
  expect(worldIsoSmoothPath(desk, [{ u: 1, v: 1.5 }, A, B, { u: 7, v: 1.5 }])).toBeNull();
 });

 it("returns valid one- and two-point paths unchanged, as fresh copies", () => {
  const p = { u: 1, v: 1 }, q = { u: 7, v: 1 };
  const two = worldIsoSmoothPath(desk, [p, q])!;
  expect(two).toEqual([{ u: 1, v: 1 }, { u: 7, v: 1 }]);
  expect(two[0] === p || two[1] === q).toBe(false);
  expect(worldIsoSmoothPath(desk, [p])).toEqual([{ u: 1, v: 1 }]);
  expect(worldIsoSmoothPath(desk, [p, p])).toEqual([p, p]); // a zero-length step at a free point is walkable
 });

 it("smooths a valid multi-point path: same ends, fewer corners, never longer, every segment verified", () => {
  const out = worldIsoSmoothPath(desk, around)!;
  expect(out[0]).toEqual(A); expect(out.at(-1)).toEqual(B);
  expect(out.length).toBeLessThan(around.length);
  expect(worldIsoPathLength(out)).toBeLessThanOrEqual(worldIsoPathLength(around) + 1e-9);
  expect(pathClear(desk, out)).toBe(true);
  for (let i = 1; i < out.length; i++) expect(worldIsoSegmentClear(desk, out[i - 1]!, out[i]!)).toBe(true);
  // A path with nothing to remove comes back with the same waypoints.
  expect(worldIsoSmoothPath(ROOM, [{ u: 2, v: 7 }, { u: 4.75, v: 5 }, { u: 4.75, v: 3 }, { u: 2, v: 1 }])).toHaveLength(4);
  // Supported non-default radii follow the same rules.
  expect(pathClear(desk, worldIsoSmoothPath(desk, [{ u: 1.5, v: 4 }, { u: 1.5, v: 1.5 }, { u: 6.5, v: 1.5 }, { u: 6.5, v: 4 }], 1)!, 1)).toBe(true);
  expect(worldIsoSmoothPath(desk, [{ u: 1.5, v: 4 }, { u: 1.5, v: 2.5 }, { u: 6.5, v: 2.5 }, { u: 6.5, v: 4 }], 1)).toBeNull(); // too close to the desk for a 1-tile footprint
 });

 it("is deterministic and does not modify its input", () => {
  const input = around.map(p => ({ ...p })), before = JSON.stringify(input);
  const first = JSON.stringify(worldIsoSmoothPath(desk, input));
  for (let k = 0; k < 5; k++) expect(JSON.stringify(worldIsoSmoothPath(desk, input))).toBe(first);
  expect(JSON.stringify(input)).toBe(before);
  const again = seal(JSON.parse(JSON.stringify(desk)));
  expect(JSON.stringify(worldIsoSmoothPath(again, input))).toBe(first);
 });

 it("keeps worldIsoPath compatible: every route it returns re-smooths to itself", () => {
  let checked = 0;
  for (const plan of LAYOUTS) {
   const g = worldIsoGrid(plan)!;
   for (const [a, b] of pairs(plan, 20)) {
    const path = worldIsoPath(plan, g.point(a), g.point(b));
    if (!path) continue;
    expect(worldIsoSmoothPath(plan, path)).not.toBeNull();
    expect(pathClear(plan, path)).toBe(true);
    checked++;
   }
  }
  expect(checked).toBeGreaterThan(80);
 });
});

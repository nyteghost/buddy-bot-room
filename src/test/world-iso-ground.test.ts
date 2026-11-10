import { describe, expect, it } from "vitest";
import { WORLD_ISO_GREYBOX } from "@/lib/world-iso-greybox";
import {
 WORLD_ISO_FOOTPRINT, WORLD_ISO_GRID_STEP, worldIsoBoxDistance, worldIsoFloorProblems, worldIsoGrid, worldIsoGridRoute, worldIsoInsidePolygon,
 worldIsoOctileTiles, worldIsoPath, worldIsoPathLength, worldIsoPointFree, worldIsoSegmentBoxDistance, worldIsoSegmentClear, worldIsoSegmentDistance,
 worldIsoSegmentsIntersect, worldIsoSmoothPath, worldIsoValidatePlan, type GroundPlan,
} from "@/lib/world-iso-ground";
import type { GroundPoint } from "@/lib/world-iso-projection";

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

// ---------- PM review corrections (PR #40): regression tests ----------
const square = (n: number): GroundPoint[] => [{ u: 0, v: 0 }, { u: n, v: 0 }, { u: n, v: n }, { u: 0, v: n }];
const bare = (id: string, floor: GroundPoint[], colliders: GroundPlan["colliders"] = []): GroundPlan =>
 ({ id, floor, colliders, anchors: [{ id: "door", kind: "door", at: { u: 1, v: 1 }, facing: "s" }], door: "door" });
/** Layouts chosen so a greedy (over-estimating) search would take a longer way round. */
const LAYOUTS: GroundPlan[] = [
 ROOM,
 bare("staggered-walls", [{ u: 0, v: 0 }, { u: 12, v: 0 }, { u: 12, v: 10 }, { u: 0, v: 10 }], [{ id: "a", u1: 3, v1: 1, u2: 4, v2: 9 }, { id: "b", u1: 7, v1: 1.5, u2: 8, v2: 10 }]),
 bare("u-trap", square(12), [{ id: "back", u1: 6, v1: 3, u2: 7, v2: 9 }, { id: "top", u1: 3, v1: 3, u2: 6, v2: 4 }, { id: "bottom", u1: 3, v1: 8, u2: 6, v2: 9 }]),
 bare("pillars", square(10), [{ id: "p1", u1: 2.2, v1: 2.2, u2: 3.1, v2: 3.1 }, { id: "p2", u1: 4.7, v1: 4.4, u2: 5.6, v2: 5.3 }, { id: "p3", u1: 6.9, v1: 2.1, u2: 7.6, v2: 6.8 }, { id: "p4", u1: 2.4, v1: 6.3, u2: 5.9, v2: 7.1 }]),
 bare("l-shaped-floor", [{ u: 0, v: 0 }, { u: 10, v: 0 }, { u: 10, v: 4 }, { u: 4, v: 4 }, { u: 4, v: 10 }, { u: 0, v: 10 }]),
 WORLD_ISO_GREYBOX,
];
/** Independent oracle: dense sampling of the footprint along a segment, using only point distances. */
function sampledClear(plan: GroundPlan, a: GroundPoint, b: GroundPoint, radius = r): boolean {
 const steps = Math.max(1, Math.ceil(Math.hypot(b.u - a.u, b.v - a.v) / 0.004));
 for (let k = 0; k <= steps; k++) {
  const p = { u: a.u + (b.u - a.u) * k / steps, v: a.v + (b.v - a.v) * k / steps };
  if (!worldIsoInsidePolygon(p, plan.floor)) return false;
  for (const c of plan.colliders) if (worldIsoBoxDistance(p, c) < radius - 1e-6) return false;
  for (let i = 0, j = plan.floor.length - 1; i < plan.floor.length; j = i++) {
   const e1 = plan.floor[j]!, e2 = plan.floor[i]!, du = e2.u - e1.u, dv = e2.v - e1.v;
   const t = Math.max(0, Math.min(1, ((p.u - e1.u) * du + (p.v - e1.v) * dv) / (du * du + dv * dv)));
   if (Math.hypot(p.u - (e1.u + t * du), p.v - (e1.v + t * dv)) < radius - 1e-6) return false;
  }
 }
 return true;
}
/** Reference shortest paths: plain Dijkstra (no heuristic) over the same grid graph. */
function dijkstra(plan: GroundPlan, source: number): Float64Array {
 const g = worldIsoGrid(plan)!, n = g.cols * g.rows, dist = new Float64Array(n).fill(Infinity), done = new Uint8Array(n);
 dist[source] = 0;
 for (;;) {
  let at = -1, best = Infinity;
  for (let i = 0; i < n; i++) if (!done[i] && dist[i]! < best) { best = dist[i]!; at = i; }
  if (at < 0) return dist;
  done[at] = 1;
  for (const e of g.neighbours(at)) if (best + e.cost < dist[e.to]!) dist[e.to] = best + e.cost;
 }
}
const freeNodes = (plan: GroundPlan) => { const g = worldIsoGrid(plan)!, out: number[] = []; for (let i = 0; i < g.cols * g.rows; i++) if (g.free(i)) out.push(i); return out; };
/** Deterministic spread of node pairs across a layout. */
const pairs = (plan: GroundPlan, count: number) => { const nodes = freeNodes(plan), out: [number, number][] = []; for (let k = 0; k < count; k++) out.push([nodes[(k * 7919) % nodes.length]!, nodes[(k * 104729 + 3571) % nodes.length]!]); return out; };

describe("A* optimality (PM finding 1)", () => {
 it("measures the heuristic in tiles, the same unit as edge costs", () => {
  expect(worldIsoOctileTiles({ u: 0, v: 0 }, { u: 1, v: 0 })).toBe(1);           // one tile = two grid steps = cost 2 × 0.5
  expect(worldIsoOctileTiles({ u: 0, v: 0 }, { u: 1, v: 1 })).toBeCloseTo(Math.SQRT2, 12);
  const g = worldIsoGrid(ROOM)!, edge = g.neighbours(freeNodes(ROOM)[40]!);
  for (const e of edge) expect([WORLD_ISO_GRID_STEP, Math.SQRT2 * WORLD_ISO_GRID_STEP].some(c => Math.abs(c - e.cost) < 1e-12)).toBe(true);
 });

 it("never over-estimates: h ≤ true grid distance for every node (admissible)", () => {
  for (const plan of LAYOUTS) {
   const g = worldIsoGrid(plan)!, nodes = freeNodes(plan), goal = nodes[(nodes.length * 2 / 3) | 0]!, truth = dijkstra(plan, goal);
   for (const id of nodes) if (Number.isFinite(truth[id]!)) expect(worldIsoOctileTiles(g.point(id), g.point(goal))).toBeLessThanOrEqual(truth[id]! + 1e-9);
  }
 });

 it("returns exactly the Dijkstra shortest grid distance on every obstacle layout", () => {
  let compared = 0;
  for (const plan of LAYOUTS) {
   const g = worldIsoGrid(plan)!;
   for (const [a, b] of pairs(plan, 40)) {
    const route = worldIsoGridRoute(plan, g.point(a), g.point(b)), truth = dijkstra(plan, a)[b]!;
    if (!Number.isFinite(truth)) { expect(route).toBeNull(); continue; }
    expect(route).not.toBeNull();
    expect(route!.start).toBe(a); expect(route!.goal).toBe(b);
    expect(Math.abs(route!.cost - truth)).toBeLessThan(1e-9);
    compared++;
   }
  }
  expect(compared).toBeGreaterThan(200);
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

 it("keeps deterministic tie-breaking: repeated and fresh-plan queries give identical routes", () => {
  const plan = LAYOUTS[3]!, copy: GroundPlan = JSON.parse(JSON.stringify(plan));
  for (const [a, b] of pairs(plan, 15)) {
   const g = worldIsoGrid(plan)!;
   const first = worldIsoGridRoute(plan, g.point(a), g.point(b)), again = worldIsoGridRoute(plan, g.point(a), g.point(b)), fresh = worldIsoGridRoute(copy, g.point(a), g.point(b));
   expect(again).toEqual(first); expect(fresh).toEqual(first);
  }
 });
});

describe("swept-footprint clearance on every movement segment (PM finding 2)", () => {
 it("computes exact segment distances", () => {
  expect(worldIsoSegmentsIntersect({ u: 0, v: 0 }, { u: 2, v: 2 }, { u: 0, v: 2 }, { u: 2, v: 0 })).toBe(true);
  expect(worldIsoSegmentsIntersect({ u: 0, v: 0 }, { u: 1, v: 0 }, { u: 2, v: 0 }, { u: 3, v: 0 })).toBe(false);
  expect(worldIsoSegmentDistance({ u: 0, v: 0 }, { u: 4, v: 0 }, { u: 2, v: 1 }, { u: 2, v: 3 })).toBeCloseTo(1, 12);
  const box = { id: "b", u1: 2, v1: 2, u2: 3, v2: 3 };
  expect(worldIsoSegmentBoxDistance({ u: 0, v: 0 }, { u: 5, v: 5 }, box)).toBe(0);                // passes through
  expect(worldIsoSegmentBoxDistance({ u: 0, v: 1.5 }, { u: 5, v: 1.5 }, box)).toBeCloseTo(0.5, 12); // passes beside
  expect(worldIsoSegmentBoxDistance({ u: 1, v: 3 }, { u: 2, v: 4 }, box)).toBeCloseTo(Math.SQRT1_2, 12); // passes a corner diagonally
 });

 it("blocks a diagonal step through an obstacle that sits between four free grid nodes", () => {
  // A thin post at the centre of a grid cell is 0.339 tile from each of the four nodes around it (> 0.3 footprint),
  // so all four nodes are free and the old node-only guard allowed both diagonals straight through the post.
  const plan = bare("post", square(6), [{ id: "post", u1: 2.24, v1: 2.24, u2: 2.26, v2: 2.26 }]);
  const g = worldIsoGrid(plan)!, id = (u: number, v: number) => Math.round(v / 0.5) * g.cols + Math.round(u / 0.5);
  for (const [u, v] of [[2, 2], [2.5, 2], [2, 2.5], [2.5, 2.5]] as const) expect(g.free(id(u, v))).toBe(true);
  expect(g.neighbours(id(2, 2)).some(e => e.to === id(2.5, 2.5))).toBe(false);
  expect(g.neighbours(id(2.5, 2)).some(e => e.to === id(2, 2.5))).toBe(false);
  // The orthogonal edges of that cell pass 0.24 tile from the post (< 0.3), so they are closed too; node checks alone missed this.
  expect(g.neighbours(id(2, 2)).some(e => e.to === id(2.5, 2))).toBe(false);
  expect(g.neighbours(id(1.5, 2)).some(e => e.to === id(2, 2))).toBe(true);
  expect(worldIsoSegmentClear(plan, { u: 2, v: 2 }, { u: 2.5, v: 2.5 })).toBe(false);
  const path = worldIsoPath(plan, { u: 1, v: 1 }, { u: 3.5, v: 3.5 })!;
  for (let i = 1; i < path.length; i++) expect(sampledClear(plan, path[i - 1]!, path[i]!)).toBe(true);
  expect(worldIsoPathLength(path)).toBeGreaterThan(Math.hypot(2.5, 2.5));
 });

 it("does not cut the inside corner of a wall, a desk, or a concave floor", () => {
  const corner = bare("desk-corner", square(8), [{ id: "desk", u1: 3, v1: 3, u2: 5, v2: 5 }]);
  expect(worldIsoPointFree(corner, { u: 2.6, v: 3.1 }) && worldIsoPointFree(corner, { u: 3.1, v: 2.6 })).toBe(true);
  expect(worldIsoSegmentClear(corner, { u: 2.6, v: 3.1 }, { u: 3.1, v: 2.6 })).toBe(false); // both ends free, but the diagonal passes 0.21 tile from the desk corner
  expect(worldIsoSegmentClear(corner, { u: 2.5, v: 3 }, { u: 3, v: 2.5 })).toBe(true);      // 0.35 tile from the corner: a full footprint fits
  const lFloor = LAYOUTS[4]!;
  expect(worldIsoSegmentClear(lFloor, { u: 3.5, v: 4.5 }, { u: 4.5, v: 3.5 })).toBe(false); // across the reflex corner
  expect(worldIsoSegmentClear(lFloor, { u: 2, v: 8 }, { u: 8, v: 2 })).toBe(false);          // leaves the floor entirely
  const path = worldIsoPath(lFloor, { u: 2, v: 8 }, { u: 8, v: 2 })!;
  expect(path).not.toBeNull();
  for (let i = 1; i < path.length; i++) expect(sampledClear(lFloor, path[i - 1]!, path[i]!)).toBe(true);
 });

 it("treats narrow passages exactly: one footprint wide passes, anything less is refused", () => {
  const gap = (width: number) => bare("gap", square(8), [{ id: "l", u1: 0, v1: 3.5, u2: 4 - width / 2, v2: 4.5 }, { id: "r", u1: 4 + width / 2, v1: 3.5, u2: 8, v2: 4.5 }]);
  expect(worldIsoPath(gap(0.62), { u: 4, v: 1 }, { u: 4, v: 7 })).toEqual([{ u: 4, v: 1 }, { u: 4, v: 7 }]);
  expect(worldIsoPath(gap(0.58), { u: 4, v: 1 }, { u: 4, v: 7 })).toBeNull();
  // A diagonal slot between two offset boxes, narrower than a footprint, cannot be squeezed through.
  const slot = bare("diagonal-slot", square(8), [{ id: "a", u1: 0, v1: 0, u2: 4, v2: 3.9 }, { id: "b", u1: 4.1, v1: 4, u2: 8, v2: 8 }, { id: "c", u1: 0, v1: 7, u2: 1, v2: 8 }]);
  expect(worldIsoPointFree(slot, { u: 2, v: 5.5 })).toBe(true);
  expect(worldIsoPointFree(slot, { u: 6, v: 2 })).toBe(true);
  expect(worldIsoPath(slot, { u: 2, v: 5.5 }, { u: 6, v: 2 })).toBeNull();
 });

 it("every raw grid edge on every layout passes an independent dense-sampling check", () => {
  let edges = 0;
  for (const plan of LAYOUTS) {
   const g = worldIsoGrid(plan)!;
   for (const id of freeNodes(plan)) for (const e of g.neighbours(id)) { edges++; if (!sampledClear(plan, g.point(id), g.point(e.to))) throw new Error(`${plan.id}: edge ${id}→${e.to} clips`); }
  }
  expect(edges).toBeGreaterThan(5000);
 });

 it("every segment of every smoothed path passes the same independent check", () => {
  let segments = 0;
  for (const plan of LAYOUTS) {
   const g = worldIsoGrid(plan)!;
   for (const [a, b] of pairs(plan, 60)) {
    const path = worldIsoPath(plan, g.point(a), g.point(b));
    if (!path) continue;
    for (let i = 1; i < path.length; i++) { segments++; expect(sampledClear(plan, path[i - 1]!, path[i]!)).toBe(true); }
   }
  }
  expect(segments).toBeGreaterThan(300);
  // Smoothing itself never joins two points through furniture.
  expect(worldIsoSmoothPath(ROOM, [{ u: 2, v: 7 }, { u: 4.75, v: 5 }, { u: 4.75, v: 3 }, { u: 2, v: 1 }])).toHaveLength(4);
 });
});

describe("malformed room geometry fails closed (PM finding 3)", () => {
 const codes = (plan: unknown) => worldIsoValidatePlan(plan as GroundPlan).problems.map(p => p.code);
 const anchor = { id: "door", kind: "door", at: { u: 1, v: 1 }, facing: "s" } as const;
 const withFloor = (floor: unknown) => ({ id: "bad", floor, colliders: [], anchors: [anchor], door: "door" });

 it("rejects self-intersecting floors", () => {
  expect(codes(withFloor([{ u: 0, v: 0 }, { u: 6, v: 6 }, { u: 6, v: 0 }, { u: 0, v: 6 }]))).toContain("floor-self-intersecting");           // bow-tie
  expect(codes(withFloor([{ u: 0, v: 0 }, { u: 8, v: 0 }, { u: 8, v: 6 }, { u: 3, v: -2 }, { u: 0, v: 6 }]))).toContain("floor-self-intersecting"); // spike through an edge
  expect(codes(withFloor([{ u: 0, v: 0 }, { u: 6, v: 0 }, { u: 3, v: 0 }, { u: 3, v: 5 }]))).toContain("floor-self-intersecting");             // edge folds back on itself
  expect(worldIsoFloorProblems([{ u: 0, v: 0 }, { u: 10, v: 0 }, { u: 10, v: 4 }, { u: 4, v: 4 }, { u: 4, v: 10 }, { u: 0, v: 10 }])).toEqual([]); // concave but simple: fine
 });

 it("rejects zero-area and degenerate outlines", () => {
  expect(codes(withFloor([{ u: 0, v: 0 }, { u: 4, v: 4 }, { u: 8, v: 8 }]))).toContain("floor-degenerate");               // collinear
  expect(codes(withFloor([{ u: 0, v: 0 }, { u: 5, v: 0 }, { u: 5, v: 0 }, { u: 0, v: 5 }]))).toContain("floor-degenerate"); // repeated corner
  expect(codes(withFloor([{ u: 0, v: 0 }, { u: 0.5, v: 0 }, { u: 0.5, v: 0.5 }, { u: 0, v: 0.5 }]))).toContain("floor-degenerate"); // sliver
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
  const withCollider = (c: unknown) => ({ ...withFloor(square(8)), colliders: [c] });
  for (const c of [
   { id: "nan", u1: Number.NaN, v1: 1, u2: 3, v2: 3 }, { id: "inf", u1: 1, v1: 1, u2: Infinity, v2: 3 }, { id: "flipped", u1: 3, v1: 1, u2: 2, v2: 3 },
   { id: "flat", u1: 1, v1: 2, u2: 3, v2: 2 }, { id: "missing", u1: 1, v1: 1 }, { u1: 1, v1: 1, u2: 2, v2: 2 }, null, "desk",
  ]) expect(codes(withCollider(c))).toContain("collider-invalid");
 });

 it("rejects a door that is missing or not of kind door, and malformed anchors", () => {
  const good = withFloor(square(8));
  expect(codes({ ...good, anchors: [{ ...anchor, kind: "visitor" }] })).toContain("door-kind-invalid");
  expect(codes({ ...good, anchors: [{ ...anchor, kind: "seat", front: "x", standFallback: "y" }] })).toContain("door-kind-invalid");
  expect(codes({ ...good, door: "elsewhere" })).toContain("door-missing");
  expect(codes({ ...good, anchors: [{ ...anchor, kind: "trapdoor" }] })).toContain("anchor-invalid");
  expect(codes({ ...good, anchors: [{ ...anchor, kind: "trapdoor" }] })).toContain("door-missing");
  expect(codes({ ...good, anchors: [anchor, { id: "v", kind: "visitor", at: { u: Number.NaN, v: 2 }, facing: "s" }] })).toContain("anchor-invalid");
  expect(codes({ ...good, anchors: [anchor, { id: "v", kind: "visitor", at: { u: 3, v: 3 }, facing: "up" }] })).toContain("anchor-invalid");
  expect(codes({ ...good, anchors: [anchor, null] })).toContain("anchor-invalid");
  expect(codes(good)).toEqual([]);
 });

 it("explains every problem in words and never throws", () => {
  const bad: unknown[] = [
   null, undefined, 7, "plan", {}, withFloor([]), withFloor([{ u: 0, v: 0 }, { u: 6, v: 6 }, { u: 6, v: 0 }, { u: 0, v: 6 }]),
   { ...withFloor(square(8)), colliders: [{ id: "c", u1: 1, v1: 1, u2: Number.NaN, v2: 2 }], anchors: [null, 3, { id: 5 }] },
  ];
  for (const plan of bad) {
   const report = worldIsoValidatePlan(plan as GroundPlan);
   expect(report.ok).toBe(false);
   expect(report.problems.length).toBeGreaterThan(0);
   for (const p of report.problems) { expect(p.message.length).toBeGreaterThan(20); expect(typeof p.id).toBe("string"); }
   expect(report.routes).toEqual({});
  }
 });

 it("refuses to walk on malformed geometry: no grid, no free points, no paths", () => {
  const bowTie = withFloor([{ u: 0, v: 0 }, { u: 6, v: 6 }, { u: 6, v: 0 }, { u: 0, v: 6 }]) as unknown as GroundPlan;
  const badBox = { ...withFloor(square(8)), colliders: [{ id: "c", u1: 3, v1: 1, u2: 2, v2: 2 }] } as unknown as GroundPlan;
  for (const plan of [bowTie, badBox]) {
   expect(worldIsoGrid(plan)).toBeNull();
   expect(worldIsoPointFree(plan, { u: 1, v: 1 })).toBe(false);
   expect(worldIsoSegmentClear(plan, { u: 1, v: 1 }, { u: 1.5, v: 1 })).toBe(false);
   expect(worldIsoPath(plan, { u: 1, v: 1 }, { u: 1.5, v: 1 })).toBeNull();
   expect(worldIsoGridRoute(plan, { u: 1, v: 1 }, { u: 1.5, v: 1 })).toBeNull();
  }
 });
});

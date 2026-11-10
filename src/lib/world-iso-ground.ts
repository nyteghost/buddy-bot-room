import { WORLD_HD_DIRECTIONS, type WorldHdDirection } from "./world-hd";
import type { GroundPoint } from "./world-iso-projection";

/**
 * Living Universe — isometric ground engine (Step 1a): walkable floor, colliders and paths.
 *
 * Units are ground tiles throughout (positions, edge costs, heuristic, clearances). The walkable floor is a
 * simple polygon; furniture blocks feet through axis-aligned ground boxes (most props sit on the tile grid);
 * a character is a disc of WORLD_ISO_FOOTPRINT tiles around its feet.
 *
 * Paths are A* on a half-tile grid (8 neighbours, diagonal cost √2 · step). Every grid edge, orthogonal or
 * diagonal, is accepted only if the whole footprint stays clear along it: the swept-disc test is exact
 * (segment-to-box and segment-to-edge distances), not sampled, so a diagonal step cannot clip a box corner
 * that sits between grid nodes. Diagonals additionally may not cut a corner (both orthogonal neighbours
 * free). The grid route is then string-pulled with the same exact test.
 *
 * Plans are treated as immutable (the grey box is frozen). Malformed geometry fails closed: path queries on
 * a plan whose floor or colliders are invalid return null, and `worldIsoValidatePlan` reports why without
 * throwing. Pure and deterministic; not yet used by any room.
 */
export const WORLD_ISO_FOOTPRINT = 0.3;
export const WORLD_ISO_GRID_STEP = 0.5;
/** Two anchors that may be occupied at the same time keep at least this far apart (two footprints). */
export const WORLD_ISO_ANCHOR_SPACING = 2 * WORLD_ISO_FOOTPRINT;
/** Floors smaller than this (square tiles) are degenerate. */
export const WORLD_ISO_MIN_FLOOR_AREA = 1;

export type GroundBox = Readonly<{ id: string; u1: number; v1: number; u2: number; v2: number }>;
export const WORLD_ISO_ANCHOR_KINDS = ["seat", "stand", "visitor", "door", "chat", "sofa", "coffee", "window", "board", "shelf", "plant"] as const;
export type GroundAnchorKind = (typeof WORLD_ISO_ANCHOR_KINDS)[number];
export type GroundAnchor = Readonly<{
 id: string;
 kind: GroundAnchorKind;
 at: GroundPoint;
 /** Facing taken on arrival (seats face the viewer: SE or SW). */
 facing: WorldHdDirection;
 /** Workstation index for seats and their standing fallback (index = Pal order). */
 desk?: number;
 /** Seats: the prop drawn in front of the seated character (its lower body may be covered). */
 front?: string;
 /** Seats: where a character without sitting art stands instead. */
 standFallback?: string;
}>;
export type GroundPlan = Readonly<{
 id: string;
 /** Walkable floor outline, in order (either winding), without repeating the first corner. */
 floor: readonly GroundPoint[];
 /** Blocking ground boxes (desks, sofa, shelves …). */
 colliders: readonly GroundBox[];
 anchors: readonly GroundAnchor[];
 /** Id of the anchor everyone enters by; it must be of kind "door". */
 door: string;
}>;

// ---------- exact geometry ----------
const EPS = 1e-9;
const finite = (n: unknown): n is number => typeof n === "number" && Number.isFinite(n);
const finitePoint = (p: unknown): p is GroundPoint => !!p && typeof p === "object" && finite((p as GroundPoint).u) && finite((p as GroundPoint).v);
const cross = (o: GroundPoint, a: GroundPoint, b: GroundPoint) => (a.u - o.u) * (b.v - o.v) - (a.v - o.v) * (b.u - o.u);
const onSegment = (p: GroundPoint, a: GroundPoint, b: GroundPoint) =>
 Math.min(a.u, b.u) - EPS <= p.u && p.u <= Math.max(a.u, b.u) + EPS && Math.min(a.v, b.v) - EPS <= p.v && p.v <= Math.max(a.v, b.v) + EPS;
/** True when segments ab and cd share at least one point (touching and collinear overlap included). */
export function worldIsoSegmentsIntersect(a: GroundPoint, b: GroundPoint, c: GroundPoint, d: GroundPoint): boolean {
 const d1 = cross(c, d, a), d2 = cross(c, d, b), d3 = cross(a, b, c), d4 = cross(a, b, d);
 if (((d1 > EPS && d2 < -EPS) || (d1 < -EPS && d2 > EPS)) && ((d3 > EPS && d4 < -EPS) || (d3 < -EPS && d4 > EPS))) return true;
 return (Math.abs(d1) <= EPS && onSegment(a, c, d)) || (Math.abs(d2) <= EPS && onSegment(b, c, d))
  || (Math.abs(d3) <= EPS && onSegment(c, a, b)) || (Math.abs(d4) <= EPS && onSegment(d, a, b));
}
function pointSegmentDistance(p: GroundPoint, a: GroundPoint, b: GroundPoint): number {
 const du = b.u - a.u, dv = b.v - a.v, len = du * du + dv * dv;
 const t = len ? Math.max(0, Math.min(1, ((p.u - a.u) * du + (p.v - a.v) * dv) / len)) : 0;
 return Math.hypot(p.u - (a.u + t * du), p.v - (a.v + t * dv));
}
/** Exact distance between segments ab and cd (0 when they touch or cross). */
export function worldIsoSegmentDistance(a: GroundPoint, b: GroundPoint, c: GroundPoint, d: GroundPoint): number {
 if (worldIsoSegmentsIntersect(a, b, c, d)) return 0;
 return Math.min(pointSegmentDistance(a, c, d), pointSegmentDistance(b, c, d), pointSegmentDistance(c, a, b), pointSegmentDistance(d, a, b));
}
export function worldIsoInsidePolygon(p: GroundPoint, polygon: readonly GroundPoint[]): boolean {
 let inside = false;
 for (let i = 0, j = polygon.length - 1; i < polygon.length; j = i++) {
  const a = polygon[i]!, b = polygon[j]!;
  if ((a.v > p.v) !== (b.v > p.v) && p.u < (b.u - a.u) * (p.v - a.v) / (b.v - a.v) + a.u) inside = !inside;
 }
 return inside;
}
/** Distance from a point to a box (0 inside). */
export function worldIsoBoxDistance(p: GroundPoint, box: GroundBox): number {
 const du = Math.max(box.u1 - p.u, 0, p.u - box.u2), dv = Math.max(box.v1 - p.v, 0, p.v - box.v2);
 return Math.hypot(du, dv);
}
/** Exact distance from segment ab to a box (0 when the segment touches or enters it). */
export function worldIsoSegmentBoxDistance(a: GroundPoint, b: GroundPoint, box: GroundBox): number {
 const inside = (p: GroundPoint) => p.u >= box.u1 - EPS && p.u <= box.u2 + EPS && p.v >= box.v1 - EPS && p.v <= box.v2 + EPS;
 if (inside(a) || inside(b)) return 0;
 const c = [{ u: box.u1, v: box.v1 }, { u: box.u2, v: box.v1 }, { u: box.u2, v: box.v2 }, { u: box.u1, v: box.v2 }];
 let best = Infinity;
 for (let i = 0; i < 4; i++) best = Math.min(best, worldIsoSegmentDistance(a, b, c[i]!, c[(i + 1) % 4]!));
 return best;
}
/** Gap between two boxes (0 when they touch or overlap). */
export function worldIsoBoxGap(a: GroundBox, b: GroundBox): number {
 return Math.hypot(Math.max(0, b.u1 - a.u2, a.u1 - b.u2), Math.max(0, b.v1 - a.v2, a.v1 - b.v2));
}
const boxesOverlap = (a: GroundBox, b: GroundBox) => a.u1 < b.u2 && b.u1 < a.u2 && a.v1 < b.v2 && b.v1 < a.v2;
const validBox = (c: unknown): c is GroundBox => !!c && typeof c === "object" && typeof (c as GroundBox).id === "string"
 && [(c as GroundBox).u1, (c as GroundBox).v1, (c as GroundBox).u2, (c as GroundBox).v2].every(finite) && (c as GroundBox).u2 > (c as GroundBox).u1 && (c as GroundBox).v2 > (c as GroundBox).v1;
/** Signed area of a polygon (shoelace). */
export function worldIsoPolygonArea(polygon: readonly GroundPoint[]): number {
 let sum = 0;
 for (let i = 0, j = polygon.length - 1; i < polygon.length; j = i++) sum += (polygon[j]!.u * polygon[i]!.v) - (polygon[i]!.u * polygon[j]!.v);
 return sum / 2;
}
/** Problems with a floor outline: too few or non-finite corners, repeated corners, zero area, self-intersection. */
export function worldIsoFloorProblems(floor: unknown): ("floor-invalid" | "floor-degenerate" | "floor-self-intersecting")[] {
 if (!Array.isArray(floor) || floor.length < 3 || !floor.every(finitePoint)) return ["floor-invalid"];
 const pts = floor as GroundPoint[], n = pts.length, out: ("floor-degenerate" | "floor-self-intersecting")[] = [];
 for (let i = 0; i < n; i++) { const a = pts[i]!, b = pts[(i + 1) % n]!; if (Math.hypot(a.u - b.u, a.v - b.v) <= EPS) { out.push("floor-degenerate"); break; } }
 if (out.length) return out; // repeated corners make the edge tests meaningless
 if (Math.abs(worldIsoPolygonArea(pts)) < WORLD_ISO_MIN_FLOOR_AREA) out.push("floor-degenerate");
 {
  outer: for (let i = 0; i < n; i++) for (let j = i + 1; j < n; j++) {
   const a = pts[i]!, b = pts[(i + 1) % n]!, c = pts[j]!, d = pts[(j + 1) % n]!;
   const adjacent = j === i + 1 || (i === 0 && j === n - 1);
   if (adjacent) {
    // Neighbouring edges share one corner; they must not fold back over each other.
    const shared = j === i + 1 ? b : a, otherA = j === i + 1 ? a : b, otherB = j === i + 1 ? d : c;
    if (Math.abs(cross(shared, otherA, otherB)) <= EPS && (otherA.u - shared.u) * (otherB.u - shared.u) + (otherA.v - shared.v) * (otherB.v - shared.v) > 0) { out.push("floor-self-intersecting"); break outer; }
    continue;
   }
   if (worldIsoSegmentsIntersect(a, b, c, d)) { out.push("floor-self-intersecting"); break outer; }
  }
 }
 return out;
}
const geometryOk = new WeakMap<GroundPlan, boolean>();
/** True when the plan's floor and colliders are well-formed enough to walk on (cached per plan object). */
export function worldIsoGeometryOk(plan: GroundPlan): boolean {
 if (!plan || typeof plan !== "object") return false;
 const cached = geometryOk.get(plan);
 if (cached !== undefined) return cached;
 const ok = worldIsoFloorProblems(plan.floor).length === 0 && Array.isArray(plan.colliders) && plan.colliders.every(validBox);
 geometryOk.set(plan, ok);
 return ok;
}

/** Feet at `p` fit: inside the floor, at least `radius` from its outline and from every collider. */
export function worldIsoPointFree(plan: GroundPlan, p: GroundPoint, radius = WORLD_ISO_FOOTPRINT): boolean {
 if (!finitePoint(p) || !worldIsoGeometryOk(plan) || !worldIsoInsidePolygon(p, plan.floor)) return false;
 for (let i = 0, j = plan.floor.length - 1; i < plan.floor.length; j = i++) if (pointSegmentDistance(p, plan.floor[i]!, plan.floor[j]!) < radius - EPS) return false;
 for (const box of plan.colliders) if (worldIsoBoxDistance(p, box) < radius - EPS) return false;
 return true;
}
/**
 * The whole footprint stays clear while walking straight from a to b (exact swept-disc test): both ends are
 * free, and the segment keeps at least `radius` from every floor edge and every collider. With both ends
 * inside the floor and the segment never touching its outline, the whole walk stays inside.
 */
export function worldIsoSegmentClear(plan: GroundPlan, a: GroundPoint, b: GroundPoint, radius = WORLD_ISO_FOOTPRINT): boolean {
 if (!worldIsoPointFree(plan, a, radius) || !worldIsoPointFree(plan, b, radius)) return false;
 const min = Math.max(radius - EPS, EPS);
 for (let i = 0, j = plan.floor.length - 1; i < plan.floor.length; j = i++) if (worldIsoSegmentDistance(a, b, plan.floor[j]!, plan.floor[i]!) < min) return false;
 for (const box of plan.colliders) if (worldIsoSegmentBoxDistance(a, b, box) < min) return false;
 return true;
}

// ---------- grid ----------
export type WorldIsoGridEdge = Readonly<{ to: number; cost: number }>;
/** The navigation grid of a plan: node ids, node positions (tiles), free nodes and walkable edges (costs in tiles). */
export type WorldIsoGrid = Readonly<{
 cols: number; rows: number; step: number; radius: number;
 point(id: number): GroundPoint;
 free(id: number): boolean;
 /** Walkable neighbours of a free node, in a fixed order; each edge passed the exact swept-disc test. */
 neighbours(id: number): readonly WorldIsoGridEdge[];
}>;
const grids = new WeakMap<GroundPlan, Map<number, WorldIsoGrid>>();
/** Build (and cache) the half-tile navigation grid of a valid plan; null for malformed geometry. */
export function worldIsoGrid(plan: GroundPlan, radius = WORLD_ISO_FOOTPRINT): WorldIsoGrid | null {
 if (!worldIsoGeometryOk(plan)) return null;
 let byRadius = grids.get(plan);
 if (!byRadius) grids.set(plan, byRadius = new Map());
 const found = byRadius.get(radius);
 if (found) return found;
 const step = WORLD_ISO_GRID_STEP;
 const us = plan.floor.map(p => p.u), vs = plan.floor.map(p => p.v);
 const u0 = Math.floor(Math.min(...us) / step) * step, v0 = Math.floor(Math.min(...vs) / step) * step;
 const cols = Math.ceil((Math.max(...us) - u0) / step) + 1, rows = Math.ceil((Math.max(...vs) - v0) / step) + 1;
 const point = (id: number): GroundPoint => ({ u: u0 + (id % cols) * step, v: v0 + Math.floor(id / cols) * step });
 const freeNodes = new Uint8Array(cols * rows);
 for (let id = 0; id < cols * rows; id++) freeNodes[id] = worldIsoPointFree(plan, point(id), radius) ? 1 : 0;
 const edges = new Map<number, WorldIsoGridEdge[]>();
 const neighbours = (id: number): readonly WorldIsoGridEdge[] => {
  const cached = edges.get(id);
  if (cached) return cached;
  const out: WorldIsoGridEdge[] = [];
  if (freeNodes[id]) {
   const c = id % cols, r = Math.floor(id / cols);
   for (let dr = -1; dr <= 1; dr++) for (let dc = -1; dc <= 1; dc++) {
    if (!dr && !dc) continue;
    const nc = c + dc, nr = r + dr;
    if (nc < 0 || nr < 0 || nc >= cols || nr >= rows) continue;
    const n = nr * cols + nc;
    if (!freeNodes[n]) continue;
    if (dr && dc && (!freeNodes[r * cols + nc] || !freeNodes[nr * cols + c])) continue; // no corner cutting
    if (!worldIsoSegmentClear(plan, point(id), point(n), radius)) continue;        // exact swept footprint
    out.push({ to: n, cost: (dr && dc ? Math.SQRT2 : 1) * step });
   }
  }
  edges.set(id, out);
  return out;
 };
 const grid: WorldIsoGrid = Object.freeze({ cols, rows, step, radius, point, free: (id: number) => freeNodes[id] === 1, neighbours });
 byRadius.set(radius, grid);
 return grid;
}
/** Nearest free node that `p` can walk to in a straight line (searched within 1.5 tiles); ties go to the lower id. */
function nearestNode(plan: GroundPlan, g: WorldIsoGrid, p: GroundPoint): number | null {
 const u0 = g.point(0).u, v0 = g.point(0).v;
 const c0 = Math.round((p.u - u0) / g.step), r0 = Math.round((p.v - v0) / g.step), reach = Math.ceil(1.5 / g.step);
 let best: number | null = null, bestD = Infinity;
 for (let r = r0 - reach; r <= r0 + reach; r++) for (let c = c0 - reach; c <= c0 + reach; c++) {
  if (c < 0 || r < 0 || c >= g.cols || r >= g.rows) continue;
  const id = r * g.cols + c;
  if (!g.free(id)) continue;
  const q = g.point(id), d = Math.hypot(q.u - p.u, q.v - p.v);
  if (d < bestD - EPS && worldIsoSegmentClear(plan, p, q, g.radius)) { best = id; bestD = d; }
 }
 return best;
}
/** Octile distance in TILES (node positions are in tiles), admissible and consistent for √2·step / step edge costs. */
export function worldIsoOctileTiles(a: GroundPoint, b: GroundPoint): number {
 const du = Math.abs(a.u - b.u), dv = Math.abs(a.v - b.v);
 return Math.max(du, dv) + (Math.SQRT2 - 1) * Math.min(du, dv);
}

export type WorldIsoGridRoute = Readonly<{ start: number; goal: number; nodes: readonly number[]; cost: number }>;
/**
 * Raw A* route between the grid nodes nearest `from` and `to` (before smoothing). `cost` is the grid route
 * length in tiles and is the true shortest distance on the grid graph. Null when either end is not free or
 * no route exists.
 */
export function worldIsoGridRoute(plan: GroundPlan, from: GroundPoint, to: GroundPoint, radius = WORLD_ISO_FOOTPRINT): WorldIsoGridRoute | null {
 const g = worldIsoGrid(plan, radius);
 if (!g || !worldIsoPointFree(plan, from, radius) || !worldIsoPointFree(plan, to, radius)) return null;
 const start = nearestNode(plan, g, from), goal = nearestNode(plan, g, to);
 if (start === null || goal === null) return null;
 const goalPoint = g.point(goal);
 const h = (id: number) => worldIsoOctileTiles(g.point(id), goalPoint);
 const cost = new Map<number, number>([[start, 0]]), came = new Map<number, number>();
 // Binary heap keyed by (f, id) so ties resolve the same way every time.
 const heap: [number, number][] = [[h(start), start]];
 const less = (a: [number, number], b: [number, number]) => a[0] < b[0] - 1e-12 || (Math.abs(a[0] - b[0]) <= 1e-12 && a[1] < b[1]);
 const push = (item: [number, number]) => { heap.push(item); let i = heap.length - 1; while (i > 0) { const p = (i - 1) >> 1; if (!less(heap[i]!, heap[p]!)) break; [heap[i], heap[p]] = [heap[p]!, heap[i]!]; i = p; } };
 const pop = () => { const first = heap[0]!, last = heap.pop()!; if (heap.length) { heap[0] = last; let i = 0; for (;;) { const l = 2 * i + 1, r = l + 1; let m = i; if (l < heap.length && less(heap[l]!, heap[m]!)) m = l; if (r < heap.length && less(heap[r]!, heap[m]!)) m = r; if (m === i) break; [heap[i], heap[m]] = [heap[m]!, heap[i]!]; i = m; } } return first; };
 const closed = new Set<number>();
 while (heap.length) {
  const [, id] = pop();
  if (closed.has(id)) continue;
  if (id === goal) break;
  closed.add(id);
  const base = cost.get(id)!;
  for (const edge of g.neighbours(id)) {
   if (closed.has(edge.to)) continue;
   const next = base + edge.cost;
   if (next < (cost.get(edge.to) ?? Infinity) - 1e-12) { cost.set(edge.to, next); came.set(edge.to, id); push([next + h(edge.to), edge.to]); }
  }
 }
 if (!cost.has(goal)) return null;
 const nodes: number[] = [];
 for (let id: number | undefined = goal; id !== undefined; id = came.get(id)) nodes.unshift(id);
 return { start, goal, nodes, cost: cost.get(goal)! };
}

/**
 * Walkable route from `from` to `to` (both must be free), smoothed; `null` when unreachable or the plan is
 * malformed. The result starts at `from`, ends exactly at `to`, and every segment passes the exact
 * swept-footprint test.
 */
export function worldIsoPath(plan: GroundPlan, from: GroundPoint, to: GroundPoint, radius = WORLD_ISO_FOOTPRINT): GroundPoint[] | null {
 if (!worldIsoGeometryOk(plan) || !worldIsoPointFree(plan, from, radius) || !worldIsoPointFree(plan, to, radius)) return null;
 if (worldIsoSegmentClear(plan, from, to, radius)) return [from, to];
 const route = worldIsoGridRoute(plan, from, to, radius), g = worldIsoGrid(plan, radius);
 if (!route || !g) return null;
 return worldIsoSmoothPath(plan, [from, ...route.nodes.map(id => g.point(id)), to], radius);
}

/** String-pull a path: from each corner, jump to the furthest later point still reachable in a straight line. */
export function worldIsoSmoothPath(plan: GroundPlan, path: readonly GroundPoint[], radius = WORLD_ISO_FOOTPRINT): GroundPoint[] {
 if (path.length <= 2) return [...path];
 const out: GroundPoint[] = [path[0]!];
 let i = 0;
 while (i < path.length - 1) {
  let j = path.length - 1;
  while (j > i + 1 && !worldIsoSegmentClear(plan, path[i]!, path[j]!, radius)) j--;
  out.push(path[j]!);
  i = j;
 }
 return out;
}
export const worldIsoPathLength = (path: readonly GroundPoint[]) => path.reduce((sum, p, i) => i ? sum + Math.hypot(p.u - path[i - 1]!.u, p.v - path[i - 1]!.v) : 0, 0);

// ---------- validation ----------
export type GroundPlanProblemCode =
 | "plan-invalid" | "floor-invalid" | "floor-degenerate" | "floor-self-intersecting"
 | "duplicate-id" | "door-missing" | "door-kind-invalid" | "collider-invalid" | "collider-overlap"
 | "anchor-invalid" | "anchor-blocked" | "anchor-unreachable" | "anchor-crowded" | "seat-link-missing";
export type GroundPlanProblem = Readonly<{ code: GroundPlanProblemCode; id: string; message: string }>;
export type GroundPlanReport = Readonly<{ ok: boolean; problems: readonly GroundPlanProblem[]; routes: Readonly<Record<string, number>> }>;
const KINDS = new Set<string>(WORLD_ISO_ANCHOR_KINDS);
const FACINGS = new Set<string>(WORLD_HD_DIRECTIONS);
const label = (x: unknown) => typeof x === "string" ? x : "(no id)";

/**
 * Check a plan before any room uses it. Never throws: malformed input is reported, and geometry problems
 * stop the walking checks (fail closed). Checks: plan shape; floor corners finite, distinct, non-zero area and
 * not self-intersecting; unique ids; colliders finite with u1 < u2, v1 < v2 and not overlapping; anchors with a
 * known kind, a known facing and finite coordinates; the door anchor present and of kind "door"; every anchor
 * free and reachable from the door; anchors that may be occupied together not overlapping; seats linked to an
 * existing front prop and standing fallback. `routes` maps each reachable anchor to its walking distance (tiles).
 */
export function worldIsoValidatePlan(plan: GroundPlan, radius = WORLD_ISO_FOOTPRINT): GroundPlanReport {
 const problems: GroundPlanProblem[] = [];
 const add = (code: GroundPlanProblemCode, id: string, message: string) => problems.push({ code, id, message });
 const routes: Record<string, number> = {};
 const raw = plan as unknown as Record<string, unknown> | null;
 if (!raw || typeof raw !== "object" || !Array.isArray(raw["floor"]) || !Array.isArray(raw["colliders"]) || !Array.isArray(raw["anchors"]) || typeof raw["door"] !== "string") {
  add("plan-invalid", label(raw?.["id"]), "A plan needs floor, colliders and anchors lists and a door id.");
  return { ok: false, problems, routes };
 }
 const floorMessages = {
  "floor-invalid": "The walkable floor needs at least three corners with finite coordinates.",
  "floor-degenerate": `The walkable floor repeats a corner or encloses less than ${WORLD_ISO_MIN_FLOOR_AREA} square tile.`,
  "floor-self-intersecting": "The walkable floor outline crosses or folds back over itself.",
 } as const;
 for (const code of worldIsoFloorProblems(plan.floor)) add(code, label(plan.id), floorMessages[code]);
 for (const c of plan.colliders as unknown[]) if (!validBox(c)) add("collider-invalid", label((c as GroundBox | null)?.id), `Collider ${label((c as GroundBox | null)?.id)} needs a string id, finite bounds and u1 < u2, v1 < v2.`);
 const anchors: GroundAnchor[] = [];
 for (const a of plan.anchors as unknown[]) {
  const x = a as GroundAnchor | null;
  if (!x || typeof x !== "object" || typeof x.id !== "string" || !KINDS.has(x.kind) || !FACINGS.has(x.facing) || !finitePoint(x.at))
   add("anchor-invalid", label(x?.id), `Anchor ${label(x?.id)} needs a string id, a known kind, a known facing and finite coordinates.`);
  else anchors.push(x);
 }
 const ids = new Set<string>();
 for (const id of [...plan.colliders.filter(validBox).map(c => c.id), ...anchors.map(a => a.id)]) { if (ids.has(id)) add("duplicate-id", id, `Id ${id} is used more than once.`); ids.add(id); }
 const boxes = plan.colliders.filter(validBox);
 for (let i = 0; i < boxes.length; i++) for (let j = i + 1; j < boxes.length; j++)
  if (boxesOverlap(boxes[i]!, boxes[j]!)) add("collider-overlap", boxes[i]!.id, `Colliders ${boxes[i]!.id} and ${boxes[j]!.id} overlap.`);
 const door = anchors.find(a => a.id === plan.door);
 if (!door) add("door-missing", plan.door, `Door anchor ${plan.door} is missing.`);
 else if (door.kind !== "door") add("door-kind-invalid", door.id, `Anchor ${door.id} is used as the door but its kind is "${door.kind}", not "door".`);
 if (!worldIsoGeometryOk(plan)) return { ok: false, problems, routes }; // fail closed: no walking checks on bad geometry
 for (const a of anchors) {
  if (!worldIsoPointFree(plan, a.at, radius)) { add("anchor-blocked", a.id, `Anchor ${a.id} is off the floor or inside a collider.`); continue; }
  if (!door || a.id === door.id) { if (a.id === door?.id) routes[a.id] = 0; continue; }
  if (!worldIsoPointFree(plan, door.at, radius)) continue; // reported as anchor-blocked for the door itself
  const path = worldIsoPath(plan, door.at, a.at, radius);
  if (path) routes[a.id] = Math.round(worldIsoPathLength(path) * 1000) / 1000;
  else add("anchor-unreachable", a.id, `Anchor ${a.id} cannot be reached from the door.`);
 }
 // A seat and its own standing fallback are used by the same Pal, never together.
 const partner = new Map<string, string>();
 for (const a of anchors) if (a.standFallback) { partner.set(a.id, a.standFallback); partner.set(a.standFallback, a.id); }
 for (let i = 0; i < anchors.length; i++) for (let j = i + 1; j < anchors.length; j++) {
  const a = anchors[i]!, b = anchors[j]!;
  if (partner.get(a.id) === b.id) continue;
  if (Math.hypot(a.at.u - b.at.u, a.at.v - b.at.v) < WORLD_ISO_ANCHOR_SPACING - EPS) add("anchor-crowded", a.id, `Anchors ${a.id} and ${b.id} are closer than two footprints.`);
 }
 for (const a of anchors.filter(x => x.kind === "seat")) {
  if (!a.front || !boxes.some(c => c.id === a.front)) add("seat-link-missing", a.id, `Seat ${a.id} needs an existing front prop.`);
  if (!a.standFallback || !anchors.some(x => x.id === a.standFallback)) add("seat-link-missing", a.id, `Seat ${a.id} needs an existing standing fallback.`);
 }
 return { ok: problems.length === 0, problems, routes };
}

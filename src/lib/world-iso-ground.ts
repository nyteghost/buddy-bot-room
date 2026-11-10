import { WORLD_HD_DIRECTIONS, type WorldHdDirection } from "./world-hd";
import type { GroundPoint } from "./world-iso-projection";

/**
 * Living Universe — isometric ground engine (Step 1a): walkable floor, colliders and paths.
 *
 * Units are ground tiles throughout (positions, edge costs, heuristic, clearances). The walkable floor is a
 * simple polygon; furniture blocks feet through axis-aligned ground boxes; a character is a disc around its feet.
 *
 * TRUST: navigation only runs on SEALED plans. `worldIsoSealPlan` (or `worldIsoValidatePlan`, which seals and
 * then checks anchors and reachability) checks structure, size limits and geometry on the raw input, then
 * returns a deep-frozen private copy. Every query on anything else fails closed (false / null), so a caller
 * cannot walk on unvalidated geometry, and nothing a caller does to its own objects afterwards can change a
 * sealed plan or the grids cached for it. A future room-pack loader must pass imported plans through
 * `worldIsoValidatePlan` and use only `report.plan`.
 *
 * RADIUS: the footprint radius must be a finite number in [WORLD_ISO_LIMITS.minRadius, maxRadius] tiles
 * (default WORLD_ISO_FOOTPRINT = 0.3). Any other radius, and any non-finite or out-of-range position, makes
 * every query answer "blocked" / "no route". There is no silent clamping.
 *
 * LIMITS: WORLD_ISO_LIMITS bounds coordinates, floor extent, corner / collider / anchor counts, grid nodes and
 * grid work. They are checked with arithmetic before any navigation array is allocated.
 *
 * PATHS: A* over a rectilinear grid whose lines are the half-tile lines plus "clearance lines" one footprint
 * (+ a small margin) away from every collider side and floor corner. The extra lines put nodes inside any
 * axis-aligned passage that is physically wide enough, even when it falls between half-tile columns. Edges
 * join neighbouring lines (8 neighbours); each edge costs its true length and is accepted only if the whole
 * footprint stays clear along it (exact swept-disc test), and diagonals may not cut corners. Start and goal
 * connect to up to WORLD_ISO_MAX_CONNECTORS nearby nodes each, so an off-grid endpoint is not tied to a single
 * nearest node. The heuristic is the straight-line distance (admissible and consistent). The grid route is
 * then string-pulled with the same exact test. Everything is deterministic.
 */
export const WORLD_ISO_FOOTPRINT = 0.3;
export const WORLD_ISO_GRID_STEP = 0.5;
/** Two anchors that may be occupied at the same time keep at least this far apart (two footprints). */
export const WORLD_ISO_ANCHOR_SPACING = 2 * WORLD_ISO_FOOTPRINT;
/** Floors smaller than this (square tiles) are degenerate. */
export const WORLD_ISO_MIN_FLOOR_AREA = 1;
/** Clearance lines sit this far beyond one footprint from an obstacle side, so their nodes are strictly free. */
export const WORLD_ISO_CLEARANCE_MARGIN = 0.005;
/** How far (tiles) an endpoint looks for grid nodes to connect to, and how many it may use. */
export const WORLD_ISO_CONNECTOR_REACH = 1.5;
export const WORLD_ISO_MAX_CONNECTORS = 24;
const CONNECTOR_CANDIDATES = 256;

/**
 * Hard limits, checked before allocation. The approved Office is 19 × 14 tiles with 14 colliders and 48
 * anchors (about 4,000 grid nodes), so these leave roughly ten times the room on each axis.
 */
export const WORLD_ISO_LIMITS = Object.freeze({
 /** Supported footprint radius, tiles (inclusive). */
 minRadius: 0.1, maxRadius: 1,
 /** Largest absolute coordinate, tiles. */
 maxCoordinate: 1024,
 /** Largest floor width or depth, tiles. */
 maxExtent: 200,
 maxFloorCorners: 128, maxColliders: 128, maxAnchors: 256,
 /** Largest navigation grid, nodes. */
 maxGridNodes: 200_000,
 /** Largest nodes × (colliders + floor edges): bounds the clearance work of building and searching a grid. */
 maxGridWork: 20_000_000,
 /** Grids kept per plan (one per distinct radius); the oldest is dropped beyond this. */
 maxCachedRadii: 4,
});

/** Longest waypoint list worldIsoSmoothPath accepts (a route visits each grid node at most once, plus both ends). */
const SMOOTH_MAX_POINTS = WORLD_ISO_LIMITS.maxGridNodes + 2;

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

// ---------- numeric guards ----------
const EPS = 1e-9;
const finite = (n: unknown): n is number => typeof n === "number" && Number.isFinite(n);
const coordinate = (n: unknown): n is number => finite(n) && Math.abs(n) <= WORLD_ISO_LIMITS.maxCoordinate;
const validPoint = (p: unknown): p is GroundPoint => !!p && typeof p === "object" && coordinate((p as GroundPoint).u) && coordinate((p as GroundPoint).v);
/** True for a supported footprint radius: a finite number of tiles in [minRadius, maxRadius]. */
export function worldIsoRadiusOk(radius: unknown): radius is number {
 return finite(radius) && radius >= WORLD_ISO_LIMITS.minRadius && radius <= WORLD_ISO_LIMITS.maxRadius;
}

// ---------- exact geometry (pure helpers on numbers; no plan involved) ----------
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
 && [(c as GroundBox).u1, (c as GroundBox).v1, (c as GroundBox).u2, (c as GroundBox).v2].every(coordinate) && (c as GroundBox).u2 > (c as GroundBox).u1 && (c as GroundBox).v2 > (c as GroundBox).v1;
/** Signed area of a polygon (shoelace). */
export function worldIsoPolygonArea(polygon: readonly GroundPoint[]): number {
 let sum = 0;
 for (let i = 0, j = polygon.length - 1; i < polygon.length; j = i++) sum += (polygon[j]!.u * polygon[i]!.v) - (polygon[i]!.u * polygon[j]!.v);
 return sum / 2;
}
export type GroundFloorProblemCode = "floor-invalid" | "floor-too-many-corners" | "floor-too-large" | "floor-degenerate" | "floor-self-intersecting";
/** Problems with a floor outline. Size limits are checked first, before any quadratic work. */
export function worldIsoFloorProblems(floor: unknown): GroundFloorProblemCode[] {
 if (!Array.isArray(floor) || floor.length < 3) return ["floor-invalid"];
 if (floor.length > WORLD_ISO_LIMITS.maxFloorCorners) return ["floor-too-many-corners"];
 if (!floor.every(validPoint)) return ["floor-invalid"];
 const pts = floor as GroundPoint[], n = pts.length;
 let u1 = Infinity, u2 = -Infinity, v1 = Infinity, v2 = -Infinity;
 for (const p of pts) { u1 = Math.min(u1, p.u); u2 = Math.max(u2, p.u); v1 = Math.min(v1, p.v); v2 = Math.max(v2, p.v); }
 if (u2 - u1 > WORLD_ISO_LIMITS.maxExtent || v2 - v1 > WORLD_ISO_LIMITS.maxExtent) return ["floor-too-large"];
 for (let i = 0; i < n; i++) { const a = pts[i]!, b = pts[(i + 1) % n]!; if (Math.hypot(a.u - b.u, a.v - b.v) <= EPS) return ["floor-degenerate"]; }
 for (let i = 0; i < n; i++) for (let j = i + 1; j < n; j++) {
  const a = pts[i]!, b = pts[(i + 1) % n]!, c = pts[j]!, d = pts[(j + 1) % n]!;
  const adjacent = j === i + 1 || (i === 0 && j === n - 1);
  if (adjacent) {
   // Neighbouring edges share one corner; they must not fold back over each other.
   const shared = j === i + 1 ? b : a, otherA = j === i + 1 ? a : b, otherB = j === i + 1 ? d : c;
   if (Math.abs(cross(shared, otherA, otherB)) <= EPS && (otherA.u - shared.u) * (otherB.u - shared.u) + (otherA.v - shared.v) * (otherB.v - shared.v) > 0) return ["floor-self-intersecting"];
   continue;
  }
  if (worldIsoSegmentsIntersect(a, b, c, d)) return ["floor-self-intersecting"];
 }
 if (Math.abs(worldIsoPolygonArea(pts)) < WORLD_ISO_MIN_FLOOR_AREA) return ["floor-degenerate"];
 return [];
}

// ---------- sealing: the only way to obtain a walkable plan ----------
const KINDS = new Set<string>(WORLD_ISO_ANCHOR_KINDS);
const FACINGS = new Set<string>(WORLD_HD_DIRECTIONS);
const validAnchor = (x: unknown): x is GroundAnchor => {
 const a = x as GroundAnchor | null;
 return !!a && typeof a === "object" && typeof a.id === "string" && KINDS.has(a.kind) && FACINGS.has(a.facing) && validPoint(a.at)
  && (a.desk === undefined || (Number.isSafeInteger(a.desk) && a.desk >= 0)) && (a.front === undefined || typeof a.front === "string") && (a.standFallback === undefined || typeof a.standFallback === "string");
};
const sealed = new WeakSet<object>();
/** True when `plan` came out of `worldIsoSealPlan` / `worldIsoValidatePlan` (deep-frozen, geometry checked). */
export const worldIsoPlanSealed = (plan: unknown): plan is GroundPlan => !!plan && typeof plan === "object" && sealed.has(plan as object);
function structureProblems(raw: unknown): GroundPlanProblem[] {
 const problems: GroundPlanProblem[] = [];
 const add = (code: GroundPlanProblemCode, id: string, message: string) => problems.push({ code, id, message });
 const r = raw as Record<string, unknown> | null;
 if (!r || typeof r !== "object" || !Array.isArray(r["floor"]) || !Array.isArray(r["colliders"]) || !Array.isArray(r["anchors"]) || typeof r["door"] !== "string" || (r["id"] !== undefined && typeof r["id"] !== "string")) {
  add("plan-invalid", label(r?.["id"]), "A plan needs floor, colliders and anchors lists, a door id, and a text id.");
  return problems;
 }
 const L = WORLD_ISO_LIMITS, id = label(r["id"]);
 // Counts first: nothing below runs on an oversized list.
 if ((r["colliders"] as unknown[]).length > L.maxColliders) add("too-many-colliders", id, `A plan may have at most ${L.maxColliders} colliders.`);
 if ((r["anchors"] as unknown[]).length > L.maxAnchors) add("too-many-anchors", id, `A plan may have at most ${L.maxAnchors} anchors.`);
 const floorMessages: Record<GroundFloorProblemCode, string> = {
  "floor-invalid": `The walkable floor needs at least three corners with finite coordinates within ±${L.maxCoordinate} tiles.`,
  "floor-too-many-corners": `The walkable floor may have at most ${L.maxFloorCorners} corners.`,
  "floor-too-large": `The walkable floor may be at most ${L.maxExtent} tiles wide and deep.`,
  "floor-degenerate": `The walkable floor repeats a corner or encloses less than ${WORLD_ISO_MIN_FLOOR_AREA} square tile.`,
  "floor-self-intersecting": "The walkable floor outline crosses or folds back over itself.",
 };
 for (const code of worldIsoFloorProblems(r["floor"])) add(code, id, floorMessages[code]);
 if (problems.some(p => p.code === "too-many-colliders" || p.code === "too-many-anchors")) return problems;
 for (const c of r["colliders"] as unknown[]) if (!validBox(c)) add("collider-invalid", label((c as GroundBox | null)?.id), `Collider ${label((c as GroundBox | null)?.id)} needs a text id, finite bounds within ±${L.maxCoordinate} tiles and u1 < u2, v1 < v2.`);
 for (const a of r["anchors"] as unknown[]) if (!validAnchor(a)) add("anchor-invalid", label((a as GroundAnchor | null)?.id), `Anchor ${label((a as GroundAnchor | null)?.id)} needs a text id, a known kind, a known facing and finite coordinates within ±${L.maxCoordinate} tiles.`);
 return problems;
}
/**
 * Read a raw plan exactly once into plain objects (at most limit + 1 entries per list, known fields only).
 * All checks and the sealed copy are made from this capture, so input that changes between reads (getters,
 * proxies, later mutation) cannot pass validation with one value and be stored with another.
 */
function capture(raw: unknown): unknown {
 const r = raw as Record<string, unknown> | null;
 if (!r || typeof r !== "object") return raw;
 const L = WORLD_ISO_LIMITS;
 const isObject = (e: unknown): e is Record<string, unknown> => !!e && typeof e === "object";
 const list = (x: unknown, max: number, each: (e: unknown) => unknown) => Array.isArray(x) ? Array.from({ length: Math.min(x.length, max + 1) }, (_, i) => each(x[i])) : x;
 const point = (e: unknown) => isObject(e) ? { u: e["u"], v: e["v"] } : e;
 return {
  id: r["id"], door: r["door"],
  floor: list(r["floor"], L.maxFloorCorners, point),
  colliders: list(r["colliders"], L.maxColliders, e => isObject(e) ? { id: e["id"], u1: e["u1"], v1: e["v1"], u2: e["u2"], v2: e["v2"] } : e),
  anchors: list(r["anchors"], L.maxAnchors, e => isObject(e) ? { id: e["id"], kind: e["kind"], at: point(e["at"]), facing: e["facing"], desk: e["desk"], front: e["front"], standFallback: e["standFallback"] } : e),
 };
}
function snapshot(raw: GroundPlan): GroundPlan {
 const plan: GroundPlan = Object.freeze({
  id: typeof raw.id === "string" ? raw.id : "plan",
  floor: Object.freeze(raw.floor.map(p => Object.freeze({ u: p.u, v: p.v }))),
  colliders: Object.freeze(raw.colliders.map(c => Object.freeze({ id: c.id, u1: c.u1, v1: c.v1, u2: c.u2, v2: c.v2 }))),
  anchors: Object.freeze(raw.anchors.map(a => Object.freeze({
   id: a.id, kind: a.kind, at: Object.freeze({ u: a.at.u, v: a.at.v }), facing: a.facing,
   ...(a.desk !== undefined ? { desk: a.desk } : {}), ...(a.front !== undefined ? { front: a.front } : {}), ...(a.standFallback !== undefined ? { standFallback: a.standFallback } : {}),
  }))),
  door: raw.door,
 });
 sealed.add(plan);
 return plan;
}
/**
 * Check a raw plan's structure, size limits and geometry and return a deep-frozen private copy that the
 * navigation functions accept, or null. The copy shares no object with the input. Sealing an already sealed
 * plan returns it unchanged. Anchor placement and reachability are NOT checked here (see worldIsoValidatePlan).
 */
export function worldIsoSealPlan(raw: unknown): GroundPlan | null {
 if (worldIsoPlanSealed(raw)) return raw;
 try { const captured = capture(raw); return structureProblems(captured).length ? null : snapshot(captured as GroundPlan); } catch { return null; }
}

// ---------- clearance ----------
function pointFree(plan: GroundPlan, p: GroundPoint, radius: number): boolean {
 if (!worldIsoInsidePolygon(p, plan.floor)) return false;
 for (let i = 0, j = plan.floor.length - 1; i < plan.floor.length; j = i++) if (pointSegmentDistance(p, plan.floor[i]!, plan.floor[j]!) < radius - EPS) return false;
 for (const box of plan.colliders) if (worldIsoBoxDistance(p, box) < radius - EPS) return false;
 return true;
}
function segmentClear(plan: GroundPlan, a: GroundPoint, b: GroundPoint, radius: number): boolean {
 if (!pointFree(plan, a, radius) || !pointFree(plan, b, radius)) return false;
 const min = radius - EPS;
 for (let i = 0, j = plan.floor.length - 1; i < plan.floor.length; j = i++) if (worldIsoSegmentDistance(a, b, plan.floor[j]!, plan.floor[i]!) < min) return false;
 for (const box of plan.colliders) if (worldIsoSegmentBoxDistance(a, b, box) < min) return false;
 return true;
}
const usable = (plan: unknown, radius: unknown): plan is GroundPlan => worldIsoPlanSealed(plan) && worldIsoRadiusOk(radius);
/** Feet at `p` fit: inside the floor, at least `radius` from its outline and from every collider. False for an unsealed plan, an unsupported radius or an invalid point. */
export function worldIsoPointFree(plan: GroundPlan, p: GroundPoint, radius: number = WORLD_ISO_FOOTPRINT): boolean {
 return usable(plan, radius) && validPoint(p) && pointFree(plan, p, radius);
}
/**
 * The whole footprint stays clear while walking straight from a to b (exact swept-disc test): both ends are
 * free, and the segment keeps at least `radius` from every floor edge and every collider. False for an
 * unsealed plan, an unsupported radius or an invalid point.
 */
export function worldIsoSegmentClear(plan: GroundPlan, a: GroundPoint, b: GroundPoint, radius: number = WORLD_ISO_FOOTPRINT): boolean {
 return usable(plan, radius) && validPoint(a) && validPoint(b) && segmentClear(plan, a, b, radius);
}

// ---------- grid ----------
function gridLines(plan: GroundPlan, radius: number): { us: number[]; vs: number[] } {
 const step = WORLD_ISO_GRID_STEP, off = radius + WORLD_ISO_CLEARANCE_MARGIN;
 const build = (axis: "u" | "v") => {
  const values = plan.floor.map(p => p[axis]), lo = Math.min(...values), hi = Math.max(...values);
  const lines: number[] = [];
  for (let k = Math.ceil(lo / step - EPS); k * step <= hi + EPS; k++) lines.push(k * step);
  const extra = (x: number) => { if (x > lo && x < hi) lines.push(x); };
  for (const c of plan.colliders) { extra((axis === "u" ? c.u1 : c.v1) - off); extra((axis === "u" ? c.u2 : c.v2) + off); }
  for (const x of values) { extra(x - off); extra(x + off); }
  lines.sort((a, b) => a - b);
  const out: number[] = [];
  for (const x of lines) if (!out.length || x - out[out.length - 1]! > 1e-6) out.push(x);
  return out;
 };
 return { us: build("u"), vs: build("v") };
}
export type WorldIsoGridBudget = Readonly<{ cols: number; rows: number; nodes: number; work: number; ok: boolean }>;
/** Size of the navigation grid a sealed plan would need, computed without allocating it; null if unusable. */
export function worldIsoGridBudget(plan: GroundPlan, radius: number = WORLD_ISO_FOOTPRINT): WorldIsoGridBudget | null {
 if (!usable(plan, radius)) return null;
 const { us, vs } = gridLines(plan, radius); // at most a few thousand numbers: counts and extent are already limited
 const nodes = us.length * vs.length, work = nodes * (plan.colliders.length + plan.floor.length);
 return { cols: us.length, rows: vs.length, nodes, work, ok: nodes > 0 && nodes <= WORLD_ISO_LIMITS.maxGridNodes && work <= WORLD_ISO_LIMITS.maxGridWork };
}
export type WorldIsoGridEdge = Readonly<{ to: number; cost: number }>;
/** The navigation grid of a sealed plan. Node id = row × cols + column. Everything it returns is frozen or a fresh copy. */
export type WorldIsoGrid = Readonly<{
 cols: number; rows: number; radius: number;
 /** Grid line positions (tiles), ascending. */
 us: readonly number[]; vs: readonly number[];
 point(id: number): GroundPoint;
 /** Node on the lines nearest (u, v), or -1 when (u, v) is not on grid lines (within 1e-6). */
 nodeAt(u: number, v: number): number;
 free(id: number): boolean;
 /** Walkable neighbours of a free node, in a fixed order; each edge passed the exact swept-disc test. */
 neighbours(id: number): readonly WorldIsoGridEdge[];
}>;
const NO_EDGES: readonly WorldIsoGridEdge[] = Object.freeze([]);
const grids = new WeakMap<GroundPlan, Map<number, WorldIsoGrid>>();
const lowerBound = (xs: readonly number[], x: number) => { let lo = 0, hi = xs.length; while (lo < hi) { const m = (lo + hi) >> 1; if (xs[m]! < x) lo = m + 1; else hi = m; } return lo; };
/** Build (and cache) the navigation grid; null for an unsealed plan, an unsupported radius, or a grid over the limits. */
export function worldIsoGrid(plan: GroundPlan, radius: number = WORLD_ISO_FOOTPRINT): WorldIsoGrid | null {
 if (!usable(plan, radius)) return null;
 let byRadius = grids.get(plan);
 const found = byRadius?.get(radius);
 if (found) return found;
 const budget = worldIsoGridBudget(plan, radius);
 if (!budget?.ok) return null; // checked before any allocation
 const lines = gridLines(plan, radius), us = Object.freeze(lines.us), vs = Object.freeze(lines.vs), cols = us.length, rows = vs.length, count = cols * rows;
 const point = (id: number): GroundPoint => ({ u: us[id % cols]!, v: vs[Math.floor(id / cols)]! });
 const inRange = (id: number) => Number.isSafeInteger(id) && id >= 0 && id < count;
 const freeNodes = new Uint8Array(count);
 for (let id = 0; id < count; id++) freeNodes[id] = pointFree(plan, point(id), radius) ? 1 : 0;
 const edges = new Map<number, readonly WorldIsoGridEdge[]>();
 const neighbours = (id: number): readonly WorldIsoGridEdge[] => {
  if (!inRange(id) || !freeNodes[id]) return NO_EDGES;
  const cached = edges.get(id);
  if (cached) return cached;
  const out: WorldIsoGridEdge[] = [], c = id % cols, r = Math.floor(id / cols), here = point(id);
  for (let dr = -1; dr <= 1; dr++) for (let dc = -1; dc <= 1; dc++) {
   if (!dr && !dc) continue;
   const nc = c + dc, nr = r + dr;
   if (nc < 0 || nr < 0 || nc >= cols || nr >= rows) continue;
   const n = nr * cols + nc;
   if (!freeNodes[n]) continue;
   if (dr && dc && (!freeNodes[r * cols + nc] || !freeNodes[nr * cols + c])) continue; // no corner cutting
   const there = point(n);
   if (!segmentClear(plan, here, there, radius)) continue;                            // exact swept footprint
   out.push(Object.freeze({ to: n, cost: Math.hypot(there.u - here.u, there.v - here.v) }));
  }
  const frozen = Object.freeze(out);
  edges.set(id, frozen);
  return frozen;
 };
 const nodeAt = (u: number, v: number) => {
  if (!finite(u) || !finite(v)) return -1;
  const near = (xs: readonly number[], x: number) => { const i = lowerBound(xs, x - 1e-6); return i < xs.length && Math.abs(xs[i]! - x) <= 1e-6 ? i : -1; };
  const c = near(us, u), r = near(vs, v);
  return c < 0 || r < 0 ? -1 : r * cols + c;
 };
 const grid: WorldIsoGrid = Object.freeze({ cols, rows, radius, us, vs, point: (id: number) => inRange(id) ? point(id) : { u: Number.NaN, v: Number.NaN }, nodeAt, free: (id: number) => inRange(id) && freeNodes[id] === 1, neighbours });
 if (!byRadius) grids.set(plan, byRadius = new Map());
 if (byRadius.size >= WORLD_ISO_LIMITS.maxCachedRadii) byRadius.delete(byRadius.keys().next().value as number);
 byRadius.set(radius, grid);
 return grid;
}
export type WorldIsoConnector = Readonly<{ node: number; cost: number }>;
/**
 * Grid nodes an off-grid point can walk straight to: free nodes within WORLD_ISO_CONNECTOR_REACH tiles whose
 * connecting segment passes the exact clearance test, nearest first (ties by node id), at most
 * WORLD_ISO_MAX_CONNECTORS of the nearest candidates. Empty when the point is not free.
 */
export function worldIsoConnectors(plan: GroundPlan, p: GroundPoint, radius: number = WORLD_ISO_FOOTPRINT): WorldIsoConnector[] {
 const g = worldIsoGrid(plan, radius);
 if (!g || !validPoint(p) || !pointFree(plan, p, radius)) return [];
 const reach = WORLD_ISO_CONNECTOR_REACH, candidates: WorldIsoConnector[] = [];
 const c1 = lowerBound(g.us, p.u - reach), c2 = lowerBound(g.us, p.u + reach + EPS), r1 = lowerBound(g.vs, p.v - reach), r2 = lowerBound(g.vs, p.v + reach + EPS);
 for (let r = r1; r < r2; r++) for (let c = c1; c < c2; c++) {
  const id = r * g.cols + c;
  if (!g.free(id)) continue;
  const d = Math.hypot(g.us[c]! - p.u, g.vs[r]! - p.v);
  if (d <= reach + EPS) candidates.push({ node: id, cost: d });
 }
 candidates.sort((a, b) => a.cost - b.cost || a.node - b.node);
 const out: WorldIsoConnector[] = [];
 for (let i = 0; i < candidates.length && i < CONNECTOR_CANDIDATES && out.length < WORLD_ISO_MAX_CONNECTORS; i++)
  if (segmentClear(plan, p, g.point(candidates[i]!.node), radius)) out.push(candidates[i]!);
 return out;
}

export type WorldIsoGridRoute = Readonly<{ start: number; goal: number; nodes: readonly number[]; cost: number }>;
/**
 * Raw A* route (before smoothing) from `from` to `to` through the grid: from → a start connector → grid edges
 * → a goal connector → to. `cost` is the total length in tiles and is the shortest possible through this
 * graph. Null when the plan or radius is unusable, either end is not free, or no route exists.
 */
export function worldIsoGridRoute(plan: GroundPlan, from: GroundPoint, to: GroundPoint, radius: number = WORLD_ISO_FOOTPRINT): WorldIsoGridRoute | null {
 const g = worldIsoGrid(plan, radius);
 if (!g || !validPoint(from) || !validPoint(to)) return null;
 const starts = worldIsoConnectors(plan, from, radius), goals = worldIsoConnectors(plan, to, radius);
 if (!starts.length || !goals.length) return null;
 const exit = new Map<number, number>(goals.map(c => [c.node, c.cost]));
 const GOAL = -1; // virtual node standing for `to`
 const h = (id: number) => { if (id === GOAL) return 0; const q = g.point(id); return Math.hypot(q.u - to.u, q.v - to.v); };
 const cost = new Map<number, number>(), came = new Map<number, number>();
 // Binary heap keyed by (f, id) so ties resolve the same way every time.
 const heap: [number, number][] = [];
 const less = (a: [number, number], b: [number, number]) => a[0] < b[0] - 1e-12 || (Math.abs(a[0] - b[0]) <= 1e-12 && a[1] < b[1]);
 const push = (item: [number, number]) => { heap.push(item); let i = heap.length - 1; while (i > 0) { const p = (i - 1) >> 1; if (!less(heap[i]!, heap[p]!)) break; [heap[i], heap[p]] = [heap[p]!, heap[i]!]; i = p; } };
 const pop = () => { const first = heap[0]!, last = heap.pop()!; if (heap.length) { heap[0] = last; let i = 0; for (;;) { const l = 2 * i + 1, r = l + 1; let m = i; if (l < heap.length && less(heap[l]!, heap[m]!)) m = l; if (r < heap.length && less(heap[r]!, heap[m]!)) m = r; if (m === i) break; [heap[i], heap[m]] = [heap[m]!, heap[i]!]; i = m; } } return first; };
 const relax = (id: number, next: number, via: number | undefined) => {
  if (next < (cost.get(id) ?? Infinity) - 1e-12) { cost.set(id, next); if (via === undefined) came.delete(id); else came.set(id, via); push([next + h(id), id]); }
 };
 for (const s of starts) relax(s.node, s.cost, undefined);
 const closed = new Set<number>();
 while (heap.length) {
  const [, id] = pop();
  if (closed.has(id)) continue;
  if (id === GOAL) break;
  closed.add(id);
  const base = cost.get(id)!;
  for (const edge of g.neighbours(id)) if (!closed.has(edge.to)) relax(edge.to, base + edge.cost, id);
  const out = exit.get(id);
  if (out !== undefined) relax(GOAL, base + out, id);
 }
 if (!cost.has(GOAL)) return null;
 const nodes: number[] = [];
 for (let id = came.get(GOAL); id !== undefined; id = came.get(id)) nodes.unshift(id);
 return { start: nodes[0]!, goal: nodes[nodes.length - 1]!, nodes, cost: cost.get(GOAL)! };
}

const copy = (p: GroundPoint): GroundPoint => ({ u: p.u, v: p.v });
/**
 * Walkable route from `from` to `to`, smoothed; null when unreachable, when either end is not free, or when
 * the plan, radius or points are not usable. The result is a fresh array of fresh points that starts at
 * `from` and ends at `to`, and every segment passes the exact swept-footprint test.
 */
export function worldIsoPath(plan: GroundPlan, from: GroundPoint, to: GroundPoint, radius: number = WORLD_ISO_FOOTPRINT): GroundPoint[] | null {
 if (!usable(plan, radius) || !validPoint(from) || !validPoint(to) || !pointFree(plan, from, radius) || !pointFree(plan, to, radius)) return null;
 if (segmentClear(plan, from, to, radius)) return [copy(from), copy(to)];
 const route = worldIsoGridRoute(plan, from, to, radius), g = worldIsoGrid(plan, radius);
 if (!route || !g) return null;
 return worldIsoSmoothPath(plan, [from, ...route.nodes.map(id => g.point(id)), to], radius);
}

/**
 * String-pull a walkable path: from each corner, jump to the furthest later point reachable in a straight line.
 *
 * Contract (fail closed): the input must already be a walkable path on a sealed plan. The function returns
 * null, never a path, when the plan is not sealed, the radius is unsupported, `path` is not a non-empty array,
 * any waypoint is invalid (waypoints are never dropped or skipped over), or any consecutive pair of waypoints
 * fails the exact swept-footprint test (a single waypoint must itself be free). Otherwise it returns a fresh
 * array of fresh points with the same first and last waypoint, and every returned segment has passed the exact
 * swept-footprint test. Deterministic. A null result means "no verified path", the same as worldIsoPath.
 */
export function worldIsoSmoothPath(plan: GroundPlan, path: readonly GroundPoint[], radius: number = WORLD_ISO_FOOTPRINT): GroundPoint[] | null {
 if (!usable(plan, radius) || !Array.isArray(path) || path.length === 0 || path.length > SMOOTH_MAX_POINTS) return null;
 const points: GroundPoint[] = [];
 for (let i = 0; i < path.length; i++) { const p: unknown = path[i]; if (!validPoint(p)) return null; points.push(copy(p)); }
 if (points.length === 1) return pointFree(plan, points[0]!, radius) ? points : null;
 for (let i = 1; i < points.length; i++) if (!segmentClear(plan, points[i - 1]!, points[i]!, radius)) return null;
 const out: GroundPoint[] = [points[0]!];
 let i = 0;
 while (i < points.length - 1) {
  let j = points.length - 1;
  while (j > i + 1 && !segmentClear(plan, points[i]!, points[j]!, radius)) j--;
  out.push(points[j]!); // j === i + 1 was verified above; any further j was verified in this loop
  i = j;
 }
 return out;
}
export const worldIsoPathLength = (path: readonly GroundPoint[]) => path.reduce((sum, p, i) => i ? sum + Math.hypot(p.u - path[i - 1]!.u, p.v - path[i - 1]!.v) : 0, 0);

// ---------- validation ----------
export type GroundPlanProblemCode =
 | "plan-invalid" | "radius-invalid" | GroundFloorProblemCode
 | "too-many-colliders" | "too-many-anchors" | "grid-too-large"
 | "duplicate-id" | "door-missing" | "door-kind-invalid" | "collider-invalid" | "collider-overlap"
 | "anchor-invalid" | "anchor-blocked" | "anchor-unreachable" | "anchor-crowded" | "seat-link-missing";
export type GroundPlanProblem = Readonly<{ code: GroundPlanProblemCode; id: string; message: string }>;
export type GroundPlanReport = Readonly<{
 ok: boolean; problems: readonly GroundPlanProblem[]; routes: Readonly<Record<string, number>>;
 /** The sealed, deep-frozen plan to use from now on; null unless `ok`. */
 plan: GroundPlan | null;
}>;
function label(x: unknown): string { return typeof x === "string" ? x.slice(0, 64) : "(no id)"; }

/**
 * Fully check a raw plan before any room uses it. Never throws and never allocates beyond WORLD_ISO_LIMITS.
 * Order: plan shape → radius → counts and size limits → floor and collider geometry → anchor structure
 * (all on the raw input; any failure stops here, fail closed) → seal a private copy → grid size → unique ids,
 * collider overlaps, door present and of kind "door", every anchor free and reachable from the door, anchors
 * not crowded, seat links. `routes` maps each reachable anchor to its walking distance (tiles). `plan` is the
 * sealed copy when everything passed.
 */
export function worldIsoValidatePlan(raw: unknown, radius: number = WORLD_ISO_FOOTPRINT): GroundPlanReport {
 const problems: GroundPlanProblem[] = [];
 const add = (code: GroundPlanProblemCode, id: string, message: string) => problems.push({ code, id, message });
 const routes: Record<string, number> = {};
 const fail = (): GroundPlanReport => ({ ok: false, problems, routes: {}, plan: null });
 try {
  const captured = worldIsoPlanSealed(raw) ? raw : capture(raw);
  if (!worldIsoRadiusOk(radius)) { add("radius-invalid", label((captured as GroundPlan | null)?.id), `The footprint radius must be a number from ${WORLD_ISO_LIMITS.minRadius} to ${WORLD_ISO_LIMITS.maxRadius} tiles.`); return fail(); }
  if (!worldIsoPlanSealed(captured)) { problems.push(...structureProblems(captured)); if (problems.length) return fail(); }
  const plan = worldIsoPlanSealed(captured) ? captured : snapshot(captured as GroundPlan);
  const budget = worldIsoGridBudget(plan, radius);
  if (!budget?.ok) { add("grid-too-large", plan.id, `The plan needs a navigation grid of ${budget?.nodes ?? 0} nodes; the limit is ${WORLD_ISO_LIMITS.maxGridNodes} nodes and ${WORLD_ISO_LIMITS.maxGridWork} clearance checks. Use a smaller floor or fewer colliders.`); return fail(); }
  const anchors = plan.anchors, boxes = plan.colliders;
  const ids = new Set<string>();
  for (const id of [...boxes.map(c => c.id), ...anchors.map(a => a.id)]) { if (ids.has(id)) add("duplicate-id", id, `Id ${id} is used more than once.`); ids.add(id); }
  for (let i = 0; i < boxes.length; i++) for (let j = i + 1; j < boxes.length; j++)
   if (boxesOverlap(boxes[i]!, boxes[j]!)) add("collider-overlap", boxes[i]!.id, `Colliders ${boxes[i]!.id} and ${boxes[j]!.id} overlap.`);
  const door = anchors.find(a => a.id === plan.door);
  if (!door) add("door-missing", label(plan.door), `Door anchor ${label(plan.door)} is missing.`);
  else if (door.kind !== "door") add("door-kind-invalid", door.id, `Anchor ${door.id} is used as the door but its kind is "${door.kind}", not "door".`);
  const doorFree = !!door && pointFree(plan, door.at, radius);
  for (const a of anchors) {
   if (!pointFree(plan, a.at, radius)) { add("anchor-blocked", a.id, `Anchor ${a.id} is off the floor or inside a collider.`); continue; }
   if (!door || !doorFree) continue;
   if (a.id === door.id) { routes[a.id] = 0; continue; }
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
  return problems.length ? { ok: false, problems, routes, plan: null } : { ok: true, problems, routes, plan };
 } catch {
  add("plan-invalid", "(no id)", "The plan could not be read."); // e.g. a hostile getter on the input
  return fail();
 }
}

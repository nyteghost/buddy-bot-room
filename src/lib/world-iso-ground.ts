import type { WorldHdDirection } from "./world-hd";
import type { GroundPoint } from "./world-iso-projection";

/**
 * Living Universe — isometric ground engine (Step 1a): walkable floor, colliders and paths.
 *
 * Units are ground tiles. The walkable floor is a polygon; furniture blocks feet through axis-aligned
 * ground boxes (most props sit on the tile grid); a character is a circle of WORLD_ISO_FOOTPRINT tiles
 * around its feet. Paths are A* on a half-tile grid (8 neighbours, no corner cutting, diagonal cost √2),
 * then string-pulled so characters walk straight lines between corners. Because ground distances are
 * true distances, spacing behaves the same in every direction (the flat % floor did not guarantee that).
 *
 * Pure and deterministic: the same plan and endpoints always give the same path. Not yet used by any room.
 */
export const WORLD_ISO_FOOTPRINT = 0.3;
export const WORLD_ISO_GRID_STEP = 0.5;
/** Two anchors that may be occupied at the same time keep at least this far apart (two footprints). */
export const WORLD_ISO_ANCHOR_SPACING = 2 * WORLD_ISO_FOOTPRINT;

export type GroundBox = Readonly<{ id: string; u1: number; v1: number; u2: number; v2: number }>;
export type GroundAnchorKind = "seat" | "stand" | "visitor" | "door" | "chat" | "sofa" | "coffee" | "window" | "board" | "shelf" | "plant";
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
 /** Walkable floor outline, in order (either winding). */
 floor: readonly GroundPoint[];
 /** Blocking ground boxes (desks, sofa, shelves …). */
 colliders: readonly GroundBox[];
 anchors: readonly GroundAnchor[];
 /** Id of the anchor everyone enters by. */
 door: string;
}>;

// ---------- geometry ----------
export function worldIsoInsidePolygon(p: GroundPoint, polygon: readonly GroundPoint[]): boolean {
 let inside = false;
 for (let i = 0, j = polygon.length - 1; i < polygon.length; j = i++) {
  const a = polygon[i]!, b = polygon[j]!;
  if ((a.v > p.v) !== (b.v > p.v) && p.u < (b.u - a.u) * (p.v - a.v) / (b.v - a.v) + a.u) inside = !inside;
 }
 return inside;
}
function segmentDistance(p: GroundPoint, a: GroundPoint, b: GroundPoint): number {
 const du = b.u - a.u, dv = b.v - a.v, len = du * du + dv * dv;
 const t = len ? Math.max(0, Math.min(1, ((p.u - a.u) * du + (p.v - a.v) * dv) / len)) : 0;
 return Math.hypot(p.u - (a.u + t * du), p.v - (a.v + t * dv));
}
/** Distance from a point to a box (0 inside). */
export function worldIsoBoxDistance(p: GroundPoint, box: GroundBox): number {
 const du = Math.max(box.u1 - p.u, 0, p.u - box.u2), dv = Math.max(box.v1 - p.v, 0, p.v - box.v2);
 return Math.hypot(du, dv);
}
/** Gap between two boxes (0 when they touch or overlap). */
export function worldIsoBoxGap(a: GroundBox, b: GroundBox): number {
 return Math.hypot(Math.max(0, b.u1 - a.u2, a.u1 - b.u2), Math.max(0, b.v1 - a.v2, a.v1 - b.v2));
}
const boxesOverlap = (a: GroundBox, b: GroundBox) => a.u1 < b.u2 && b.u1 < a.u2 && a.v1 < b.v2 && b.v1 < a.v2;

/** Feet at `p` fit: inside the floor, at least `radius` from its outline and from every collider. */
export function worldIsoPointFree(plan: GroundPlan, p: GroundPoint, radius = WORLD_ISO_FOOTPRINT): boolean {
 if (!Number.isFinite(p.u) || !Number.isFinite(p.v) || !worldIsoInsidePolygon(p, plan.floor)) return false;
 for (let i = 0, j = plan.floor.length - 1; i < plan.floor.length; j = i++) if (segmentDistance(p, plan.floor[i]!, plan.floor[j]!) < radius - 1e-9) return false;
 for (const box of plan.colliders) if (worldIsoBoxDistance(p, box) < radius - 1e-9) return false;
 return true;
}
/** A straight walk from a to b keeps the whole footprint free (sampled every 0.05 tile). */
export function worldIsoSegmentClear(plan: GroundPlan, a: GroundPoint, b: GroundPoint, radius = WORLD_ISO_FOOTPRINT): boolean {
 const steps = Math.max(1, Math.ceil(Math.hypot(b.u - a.u, b.v - a.v) / 0.05));
 for (let i = 0; i <= steps; i++) {
  const t = i / steps;
  if (!worldIsoPointFree(plan, { u: a.u + (b.u - a.u) * t, v: a.v + (b.v - a.v) * t }, radius)) return false;
 }
 return true;
}

// ---------- grid + A* ----------
type Grid = { u0: number; v0: number; cols: number; rows: number; free: Uint8Array; radius: number };
const grids = new WeakMap<GroundPlan, Map<number, Grid>>();
function gridOf(plan: GroundPlan, radius: number): Grid {
 let byRadius = grids.get(plan);
 if (!byRadius) grids.set(plan, byRadius = new Map());
 const found = byRadius.get(radius);
 if (found) return found;
 const us = plan.floor.map(p => p.u), vs = plan.floor.map(p => p.v);
 const u0 = Math.floor(Math.min(...us) / WORLD_ISO_GRID_STEP) * WORLD_ISO_GRID_STEP, v0 = Math.floor(Math.min(...vs) / WORLD_ISO_GRID_STEP) * WORLD_ISO_GRID_STEP;
 const cols = Math.ceil((Math.max(...us) - u0) / WORLD_ISO_GRID_STEP) + 1, rows = Math.ceil((Math.max(...vs) - v0) / WORLD_ISO_GRID_STEP) + 1;
 const free = new Uint8Array(cols * rows);
 for (let r = 0; r < rows; r++) for (let c = 0; c < cols; c++) free[r * cols + c] = worldIsoPointFree(plan, { u: u0 + c * WORLD_ISO_GRID_STEP, v: v0 + r * WORLD_ISO_GRID_STEP }, radius) ? 1 : 0;
 const grid = { u0, v0, cols, rows, free, radius };
 byRadius.set(radius, grid);
 return grid;
}
const cellPoint = (g: Grid, id: number): GroundPoint => ({ u: g.u0 + (id % g.cols) * WORLD_ISO_GRID_STEP, v: g.v0 + Math.floor(id / g.cols) * WORLD_ISO_GRID_STEP });
/** Nearest free grid cell that `p` can walk to in a straight line (searched within 1.5 tiles). */
function nearestCell(plan: GroundPlan, g: Grid, p: GroundPoint): number | null {
 const c0 = Math.round((p.u - g.u0) / WORLD_ISO_GRID_STEP), r0 = Math.round((p.v - g.v0) / WORLD_ISO_GRID_STEP);
 let best: number | null = null, bestD = Infinity;
 const reach = Math.ceil(1.5 / WORLD_ISO_GRID_STEP);
 for (let r = r0 - reach; r <= r0 + reach; r++) for (let c = c0 - reach; c <= c0 + reach; c++) {
  if (c < 0 || r < 0 || c >= g.cols || r >= g.rows || !g.free[r * g.cols + c]) continue;
  const id = r * g.cols + c, q = cellPoint(g, id), d = Math.hypot(q.u - p.u, q.v - p.v);
  if (d < bestD - 1e-9 && worldIsoSegmentClear(plan, p, q, g.radius)) { best = id; bestD = d; }
 }
 return best;
}

/**
 * Shortest walkable route from `from` to `to` (both must be free), smoothed; `null` when unreachable.
 * The result starts at `from` and ends exactly at `to`.
 */
export function worldIsoPath(plan: GroundPlan, from: GroundPoint, to: GroundPoint, radius = WORLD_ISO_FOOTPRINT): GroundPoint[] | null {
 if (!worldIsoPointFree(plan, from, radius) || !worldIsoPointFree(plan, to, radius)) return null;
 if (worldIsoSegmentClear(plan, from, to, radius)) return [from, to];
 const g = gridOf(plan, radius);
 const start = nearestCell(plan, g, from), goal = nearestCell(plan, g, to);
 if (start === null || goal === null) return null;
 const goalPoint = cellPoint(g, goal);
 const h = (id: number) => { const q = cellPoint(g, id); const du = Math.abs(q.u - goalPoint.u), dv = Math.abs(q.v - goalPoint.v); return Math.max(du, dv) + (Math.SQRT2 - 1) * Math.min(du, dv); };
 const cost = new Map<number, number>([[start, 0]]), came = new Map<number, number>();
 // Binary heap keyed by (f, id) so ties resolve the same way every time.
 const heap: [number, number][] = [[h(start), start]];
 const less = (a: [number, number], b: [number, number]) => a[0] < b[0] - 1e-12 || (Math.abs(a[0] - b[0]) <= 1e-12 && a[1] < b[1]);
 const push = (item: [number, number]) => { heap.push(item); let i = heap.length - 1; while (i > 0) { const p = (i - 1) >> 1; if (!less(heap[i]!, heap[p]!)) break; [heap[i], heap[p]] = [heap[p]!, heap[i]!]; i = p; } };
 const pop = () => { const top0 = heap[0]!, last = heap.pop()!; if (heap.length) { heap[0] = last; let i = 0; for (;;) { const l = 2 * i + 1, r = l + 1; let m = i; if (l < heap.length && less(heap[l]!, heap[m]!)) m = l; if (r < heap.length && less(heap[r]!, heap[m]!)) m = r; if (m === i) break; [heap[i], heap[m]] = [heap[m]!, heap[i]!]; i = m; } } return top0; };
 const closed = new Set<number>();
 while (heap.length) {
  const [, id] = pop();
  if (closed.has(id)) continue;
  if (id === goal) break;
  closed.add(id);
  const c = id % g.cols, r = Math.floor(id / g.cols), base = cost.get(id)!;
  for (let dr = -1; dr <= 1; dr++) for (let dc = -1; dc <= 1; dc++) {
   if (!dr && !dc) continue;
   const nc = c + dc, nr = r + dr;
   if (nc < 0 || nr < 0 || nc >= g.cols || nr >= g.rows) continue;
   const n = nr * g.cols + nc;
   if (!g.free[n] || closed.has(n)) continue;
   if (dr && dc && (!g.free[r * g.cols + nc] || !g.free[nr * g.cols + c])) continue; // no corner cutting
   const next = base + (dr && dc ? Math.SQRT2 : 1) * WORLD_ISO_GRID_STEP;
   if (next < (cost.get(n) ?? Infinity) - 1e-12) { cost.set(n, next); came.set(n, id); push([next + h(n), n]); }
  }
 }
 if (!cost.has(goal)) return null;
 const cells: GroundPoint[] = [];
 for (let id: number | undefined = goal; id !== undefined; id = came.get(id)) cells.unshift(cellPoint(g, id));
 return worldIsoSmoothPath(plan, [from, ...cells, to], radius);
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
export type GroundPlanProblemCode = "floor-invalid" | "duplicate-id" | "door-missing" | "collider-invalid" | "collider-overlap" | "anchor-blocked" | "anchor-unreachable" | "anchor-crowded" | "seat-link-missing";
export type GroundPlanProblem = Readonly<{ code: GroundPlanProblemCode; id: string; message: string }>;
export type GroundPlanReport = Readonly<{ ok: boolean; problems: readonly GroundPlanProblem[]; routes: Readonly<Record<string, number>> }>;

/**
 * Check a plan before any room uses it: floor shape, unique ids, door present, colliders valid and not
 * overlapping, every anchor free and reachable from the door, anchors that may be occupied together not
 * overlapping, and seats linked to an existing front prop and standing fallback. `routes` maps each
 * reachable anchor to its walking distance from the door (tiles).
 */
export function worldIsoValidatePlan(plan: GroundPlan, radius = WORLD_ISO_FOOTPRINT): GroundPlanReport {
 const problems: GroundPlanProblem[] = [];
 const add = (code: GroundPlanProblemCode, id: string, message: string) => problems.push({ code, id, message });
 if (plan.floor.length < 3 || plan.floor.some(p => !Number.isFinite(p.u) || !Number.isFinite(p.v))) add("floor-invalid", plan.id, "The walkable floor needs at least three finite corners.");
 const ids = new Set<string>();
 for (const id of [...plan.colliders.map(c => c.id), ...plan.anchors.map(a => a.id)]) { if (ids.has(id)) add("duplicate-id", id, `Id ${id} is used more than once.`); ids.add(id); }
 for (const c of plan.colliders) if (![c.u1, c.v1, c.u2, c.v2].every(Number.isFinite) || c.u2 <= c.u1 || c.v2 <= c.v1) add("collider-invalid", c.id, `Collider ${c.id} needs u1 < u2 and v1 < v2.`);
 for (let i = 0; i < plan.colliders.length; i++) for (let j = i + 1; j < plan.colliders.length; j++)
  if (boxesOverlap(plan.colliders[i]!, plan.colliders[j]!)) add("collider-overlap", plan.colliders[i]!.id, `Colliders ${plan.colliders[i]!.id} and ${plan.colliders[j]!.id} overlap.`);
 const door = plan.anchors.find(a => a.id === plan.door);
 if (!door) add("door-missing", plan.door, `Door anchor ${plan.door} is missing.`);
 const routes: Record<string, number> = {};
 if (problems.some(p => p.code === "floor-invalid" || p.code === "collider-invalid")) return { ok: false, problems, routes };
 for (const a of plan.anchors) {
  if (!worldIsoPointFree(plan, a.at, radius)) { add("anchor-blocked", a.id, `Anchor ${a.id} is off the floor or inside a collider.`); continue; }
  if (!door || a.id === door.id) { if (a.id === door?.id) routes[a.id] = 0; continue; }
  const path = worldIsoPath(plan, door.at, a.at, radius);
  if (path) routes[a.id] = Math.round(worldIsoPathLength(path) * 1000) / 1000;
  else add("anchor-unreachable", a.id, `Anchor ${a.id} cannot be reached from the door.`);
 }
 // A seat and its own standing fallback are used by the same Pal, never together.
 const partner = new Map<string, string>();
 for (const a of plan.anchors) if (a.standFallback) { partner.set(a.id, a.standFallback); partner.set(a.standFallback, a.id); }
 for (let i = 0; i < plan.anchors.length; i++) for (let j = i + 1; j < plan.anchors.length; j++) {
  const a = plan.anchors[i]!, b = plan.anchors[j]!;
  if (partner.get(a.id) === b.id) continue;
  if (Math.hypot(a.at.u - b.at.u, a.at.v - b.at.v) < WORLD_ISO_ANCHOR_SPACING - 1e-9) add("anchor-crowded", a.id, `Anchors ${a.id} and ${b.id} are closer than two footprints.`);
 }
 for (const a of plan.anchors.filter(x => x.kind === "seat")) {
  if (!a.front || !plan.colliders.some(c => c.id === a.front)) add("seat-link-missing", a.id, `Seat ${a.id} needs an existing front prop.`);
  if (!a.standFallback || !plan.anchors.some(x => x.id === a.standFallback)) add("seat-link-missing", a.id, `Seat ${a.id} needs an existing standing fallback.`);
 }
 return { ok: problems.length === 0, problems, routes };
}

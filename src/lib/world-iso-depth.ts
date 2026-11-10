import type { GroundBox } from "./world-iso-ground";

/**
 * Living Universe — isometric ground engine (Step 1a): draw order.
 *
 * Sorting by feet height alone fails for long props on a diagonal (a character beside the far end of a
 * desk would be drawn over it). Instead every prop has a ground box and every character is a tiny box at
 * its feet, and A is drawn before (behind) B when A's box ends before B's starts on either ground axis:
 *   A.u2 ≤ B.u1  or  A.v2 ≤ B.v1
 * The relation is only applied to pairs whose footprints can overlap on screen (their u − v ranges overlap).
 * A topological sort turns it into an order; ties and anything left undecided fall back to the
 * nearer-is-later key (u + v), then the id, so the result never depends on input order. Decals are always
 * first and overhangs (lamps, hanging plants) always last.
 *
 * Guarantees and limits:
 * - GROUND FOOTPRINTS ONLY. The sort has no sprite height, pixel bounds or anchor. It cannot tell whether a
 *   tall picture covers something outside its footprint, how layers inside one prop (chair back, monitor)
 *   stack against a seated character, or whether a face is hidden. Those need real art and the renderer.
 * - Cycles: for valid boxes that do not intersect, the rule is the "blocks the view along the screen's
 *   depth axis" relation between disjoint convex shapes, which cannot cycle. Intersecting boxes (a cross of
 *   two props) can cycle. A cycle never loops or throws: the lowest-key unplaced item is released, and the
 *   result reports `cycles` and `cycleIds` so a renderer can flag the layout instead of trusting it.
 * - Long props: a prop longer than WORLD_ISO_MAX_PROP_TILES must be sliced (`worldIsoSliceBox`); this splits
 *   the FOOTPRINT only — cutting the picture to match is art and renderer work.
 * - Bad input never hangs the draw loop: invalid items (non-finite, flipped or zero-size box, unknown layer)
 *   take no part in the rule and are drawn after the valid middle items in id order, listed in `invalidIds`.
 *   Above WORLD_ISO_MAX_DEPTH_ITEMS the pairwise rule is skipped and items are ordered by key alone
 *   (`overLimit`). Duplicate ids are a programming error and throw. `worldIsoDepthProblems` reports all of
 *   this up front without throwing.
 */
export type WorldIsoLayer = "decal" | "prop" | "actor" | "overhang";
export type WorldIsoDepthItem = Readonly<{ id: string; layer: WorldIsoLayer; box: Omit<GroundBox, "id"> }>;
export type WorldIsoDepthResult = Readonly<{
 order: readonly string[];
 /** How many times the fallback had to break an ordering cycle (0 for valid, non-intersecting boxes). */
 cycles: number;
 /** Ids released by the cycle fallback, in release order. */
 cycleIds: readonly string[];
 /** Ids of items whose box or layer was invalid; they are drawn after the valid middle items. */
 invalidIds: readonly string[];
 /** True when there were more than WORLD_ISO_MAX_DEPTH_ITEMS items and only the key order was used. */
 overLimit: boolean;
}>;
/** Props longer than this many tiles on either axis must be sliced (see `worldIsoSliceBox`). */
export const WORLD_ISO_MAX_PROP_TILES = 3;
const ACTOR_HALF = 0.01;
const EPS = 1e-9;

/** The tiny ground box used for a character standing or sitting at `feet`. */
export const worldIsoActorBox = (feet: Readonly<{ u: number; v: number }>): Omit<GroundBox, "id"> =>
 ({ u1: feet.u - ACTOR_HALF, v1: feet.v - ACTOR_HALF, u2: feet.u + ACTOR_HALF, v2: feet.v + ACTOR_HALF });

const key = (b: Omit<GroundBox, "id">) => (b.u1 + b.u2 + b.v1 + b.v2) / 2;
const byKey = (a: WorldIsoDepthItem, b: WorldIsoDepthItem) => key(a.box) - key(b.box) || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0);
const screenOverlap = (a: Omit<GroundBox, "id">, b: Omit<GroundBox, "id">) => (a.u1 - a.v2) < (b.u2 - b.v1) - EPS && (b.u1 - b.v2) < (a.u2 - a.v1) - EPS;
/** True when `a` must be drawn behind `b`. */
export function worldIsoBehind(a: Omit<GroundBox, "id">, b: Omit<GroundBox, "id">): boolean {
 return a.u2 <= b.u1 + EPS || a.v2 <= b.v1 + EPS;
}

/** Largest number of items one frame may sort with the pairwise rule (9 Pals + 6 visitors + 40 props is 55). */
export const WORLD_ISO_MAX_DEPTH_ITEMS = 512;
/** Most slices `worldIsoSliceBox` will ever return. */
export const WORLD_ISO_MAX_SLICES = 64;
const LAYERS: readonly string[] = ["decal", "prop", "actor", "overhang"];
type Box = Omit<GroundBox, "id">;
const validBox = (b: unknown): b is Box => !!b && typeof b === "object"
 && [(b as Box).u1, (b as Box).v1, (b as Box).u2, (b as Box).v2].every(n => typeof n === "number" && Number.isFinite(n))
 && (b as Box).u2 > (b as Box).u1 && (b as Box).v2 > (b as Box).v1;
const validItem = (i: unknown): i is WorldIsoDepthItem => !!i && typeof i === "object" && typeof (i as WorldIsoDepthItem).id === "string"
 && LAYERS.includes((i as WorldIsoDepthItem).layer) && validBox((i as WorldIsoDepthItem).box);
const byId = (a: { id: string }, b: { id: string }) => a.id < b.id ? -1 : a.id > b.id ? 1 : 0;

export type WorldIsoDepthProblemCode = "too-many-items" | "item-invalid" | "duplicate-id" | "layer-unknown" | "box-invalid" | "prop-too-long";
export type WorldIsoDepthProblem = Readonly<{ code: WorldIsoDepthProblemCode; id: string; message: string }>;
/** Check a frame's draw items without throwing: what `worldIsoDepthOrder` would reject, ignore or order by fallback. */
export function worldIsoDepthProblems(items: unknown): WorldIsoDepthProblem[] {
 const out: WorldIsoDepthProblem[] = [];
 if (!Array.isArray(items)) return [{ code: "item-invalid", id: "(list)", message: "Draw items must be a list." }];
 if (items.length > WORLD_ISO_MAX_DEPTH_ITEMS) out.push({ code: "too-many-items", id: "(list)", message: `${items.length} draw items exceed the limit of ${WORLD_ISO_MAX_DEPTH_ITEMS}; only the key order would be used.` });
 const seen = new Set<string>();
 for (const raw of items as unknown[]) {
  const item = raw as WorldIsoDepthItem | null;
  if (!item || typeof item !== "object" || typeof item.id !== "string") { out.push({ code: "item-invalid", id: "(no id)", message: "A draw item needs a string id, a layer and a box." }); continue; }
  if (seen.has(item.id)) out.push({ code: "duplicate-id", id: item.id, message: `Draw item ${item.id} appears more than once.` });
  seen.add(item.id);
  if (!LAYERS.includes(item.layer)) out.push({ code: "layer-unknown", id: item.id, message: `Draw item ${item.id} has an unknown layer; use decal, prop, actor or overhang.` });
  if (!validBox(item.box)) { out.push({ code: "box-invalid", id: item.id, message: `Draw item ${item.id} needs a finite box with u1 < u2 and v1 < v2.` }); continue; }
  if (item.layer === "prop" && Math.max(item.box.u2 - item.box.u1, item.box.v2 - item.box.v1) > WORLD_ISO_MAX_PROP_TILES + EPS)
   out.push({ code: "prop-too-long", id: item.id, message: `Prop ${item.id} is longer than ${WORLD_ISO_MAX_PROP_TILES} tiles and must be sliced.` });
 }
 return out;
}

/**
 * Back-to-front draw order for one frame. Deterministic for any input order. Throws only for duplicate ids;
 * every other bad input is handled as described in the module comment and reported in the result.
 */
export function worldIsoDepthOrder(items: readonly WorldIsoDepthItem[]): WorldIsoDepthResult {
 const list = (Array.isArray(items) ? items : []).filter((i): i is WorldIsoDepthItem => !!i && typeof i === "object" && typeof (i as WorldIsoDepthItem).id === "string");
 const seen = new Set<string>();
 for (const item of list) { if (seen.has(item.id)) throw new Error(`Duplicate draw item ${item.id}.`); seen.add(item.id); }
 const valid = list.filter(validItem), invalid = (list as readonly { id: string }[]).filter(i => !validItem(i)).sort(byId);
 const decals = valid.filter(i => i.layer === "decal").sort(byKey);
 const overhang = valid.filter(i => i.layer === "overhang").sort(byKey);
 const middle = valid.filter(i => i.layer === "prop" || i.layer === "actor").sort(byKey);
 const finish = (order: string[], cycleIds: string[], overLimit: boolean): WorldIsoDepthResult =>
  ({ order: [...decals.map(i => i.id), ...order, ...invalid.map(i => i.id), ...overhang.map(i => i.id)], cycles: cycleIds.length, cycleIds, invalidIds: invalid.map(i => i.id), overLimit });
 if (list.length > WORLD_ISO_MAX_DEPTH_ITEMS) return finish(middle.map(i => i.id), [], true);
 const n = middle.length, after: number[][] = middle.map(() => []), indegree = new Array<number>(n).fill(0);
 for (let i = 0; i < n; i++) for (let j = i + 1; j < n; j++) {
  const a = middle[i]!.box, b = middle[j]!.box;
  if (!screenOverlap(a, b)) continue;
  const ab = worldIsoBehind(a, b), ba = worldIsoBehind(b, a);
  if (ab === ba) continue; // intersecting boxes (or no overlap): left to the fallback key
  const [from, to] = ab ? [i, j] : [j, i];
  after[from]!.push(to); indegree[to]!++;
 }
 // Kahn's algorithm. `ready` is kept sorted by index (= fallback-key order) with binary insertion, so the
 // lowest-key ready item is always taken next and the result is deterministic.
 const ready: number[] = [];
 const insert = (i: number) => { let lo = 0, hi = ready.length; while (lo < hi) { const mid = (lo + hi) >> 1; if (ready[mid]! < i) lo = mid + 1; else hi = mid; } ready.splice(lo, 0, i); };
 for (let i = 0; i < n; i++) if (!indegree[i]) ready.push(i);
 const order: string[] = [], cycleIds: string[] = [], placed = new Array<boolean>(n).fill(false);
 let lowest = 0;
 while (order.length < n) {
  if (!ready.length) { // an ordering cycle: release the lowest-key unplaced item and record it
   while (placed[lowest]) lowest++;
   cycleIds.push(middle[lowest]!.id); indegree[lowest] = 0; ready.push(lowest);
  }
  const i = ready.shift()!;
  if (placed[i]) continue;
  placed[i] = true; order.push(middle[i]!.id);
  for (const j of after[i]!) if (!placed[j] && --indegree[j]! === 0) insert(j);
 }
 return finish(order, cycleIds, false);
}

/**
 * Split a long prop footprint into equal slices of at most `max` tiles along its long axis (ids `${id}#0`,
 * `#1` …). The slices tile the box exactly. A box that is not finite and positive, or a `max` that is not a
 * positive finite number, returns the box unchanged. Never returns more than WORLD_ISO_MAX_SLICES slices
 * (beyond that the slices are longer than `max`).
 */
export function worldIsoSliceBox(box: GroundBox, max = WORLD_ISO_MAX_PROP_TILES): GroundBox[] {
 if (!validBox(box) || typeof max !== "number" || !Number.isFinite(max) || max <= 0) return [box];
 const du = box.u2 - box.u1, dv = box.v2 - box.v1;
 const alongU = du >= dv, length = alongU ? du : dv;
 if (length <= max + EPS) return [box];
 const count = Math.min(WORLD_ISO_MAX_SLICES, Math.ceil(length / max - EPS)), step = length / count;
 return Array.from({ length: count }, (_, k) => alongU
  ? { id: `${box.id}#${k}`, u1: box.u1 + k * step, v1: box.v1, u2: k === count - 1 ? box.u2 : box.u1 + (k + 1) * step, v2: box.v2 }
  : { id: `${box.id}#${k}`, u1: box.u1, v1: box.v1 + k * step, u2: box.u2, v2: k === count - 1 ? box.v2 : box.v1 + (k + 1) * step });
}

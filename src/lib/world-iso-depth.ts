import type { GroundBox } from "./world-iso-ground";

/**
 * Living Universe — isometric ground engine (Step 1a): draw order.
 *
 * Sorting by feet height alone fails for long props on a diagonal (a character beside the far end of a
 * desk would be drawn over it). Instead every prop has a ground box and every character is a tiny box at
 * its feet, and A is drawn before (behind) B when A's box ends before B's starts on either ground axis:
 *   A.u2 ≤ B.u1  or  A.v2 ≤ B.v1
 * The relation is only applied to pairs whose drawings can overlap on screen (their u − v ranges overlap);
 * for those pairs it is consistent. A topological sort turns it into an order; ties and anything left
 * undecided fall back to the nearer-is-later key (u + v), then the id, so the result never depends on input
 * order. Decals are always first and overhangs (lamps, hanging plants) always last.
 */
export type WorldIsoLayer = "decal" | "prop" | "actor" | "overhang";
export type WorldIsoDepthItem = Readonly<{ id: string; layer: WorldIsoLayer; box: Omit<GroundBox, "id"> }>;
export type WorldIsoDepthResult = Readonly<{ order: readonly string[]; cycles: number }>;
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

/** Back-to-front draw order for one frame. `cycles` counts items whose order had to be decided by the fallback key. */
export function worldIsoDepthOrder(items: readonly WorldIsoDepthItem[]): WorldIsoDepthResult {
 const seen = new Set<string>();
 for (const item of items) { if (seen.has(item.id)) throw new Error(`Duplicate draw item ${item.id}.`); seen.add(item.id); }
 const decals = items.filter(i => i.layer === "decal").sort(byKey);
 const overhang = items.filter(i => i.layer === "overhang").sort(byKey);
 const middle = items.filter(i => i.layer === "prop" || i.layer === "actor").sort(byKey);
 const n = middle.length, after: number[][] = middle.map(() => []), indegree = new Array<number>(n).fill(0);
 for (let i = 0; i < n; i++) for (let j = i + 1; j < n; j++) {
  const a = middle[i]!.box, b = middle[j]!.box;
  if (!screenOverlap(a, b)) continue;
  const ab = worldIsoBehind(a, b), ba = worldIsoBehind(b, a);
  if (ab === ba) continue; // intersecting boxes (or no overlap): left to the fallback key
  const [from, to] = ab ? [i, j] : [j, i];
  after[from]!.push(to); indegree[to]!++;
 }
 // Kahn's algorithm; the ready set is kept in fallback-key order, so the result is deterministic.
 const ready: number[] = [];
 for (let i = 0; i < n; i++) if (!indegree[i]) ready.push(i);
 const order: string[] = [], placed = new Array<boolean>(n).fill(false);
 let cycles = 0;
 while (order.length < n) {
  if (!ready.length) { // a cycle (should not happen with valid boxes): release the lowest-key item
   const i = middle.findIndex((_, k) => !placed[k]);
   cycles++; ready.push(i); indegree[i] = 0;
  }
  ready.sort((x, y) => x - y);
  const i = ready.shift()!;
  if (placed[i]) continue;
  placed[i] = true; order.push(middle[i]!.id);
  for (const j of after[i]!) if (!placed[j] && --indegree[j]! === 0) ready.push(j);
 }
 return { order: [...decals.map(i => i.id), ...order, ...overhang.map(i => i.id)], cycles };
}

/** Split a long prop box into slices of at most `max` tiles along its long axis (ids `${id}#0`, `#1` …). */
export function worldIsoSliceBox(box: GroundBox, max = WORLD_ISO_MAX_PROP_TILES): GroundBox[] {
 const du = box.u2 - box.u1, dv = box.v2 - box.v1;
 const alongU = du >= dv, length = alongU ? du : dv;
 if (length <= max + EPS) return [box];
 const count = Math.ceil(length / max - EPS), step = length / count;
 return Array.from({ length: count }, (_, k) => alongU
  ? { id: `${box.id}#${k}`, u1: box.u1 + k * step, v1: box.v1, u2: k === count - 1 ? box.u2 : box.u1 + (k + 1) * step, v2: box.v2 }
  : { id: `${box.id}#${k}`, u1: box.u1, v1: box.v1 + k * step, u2: box.u2, v2: k === count - 1 ? box.v2 : box.v1 + (k + 1) * step });
}

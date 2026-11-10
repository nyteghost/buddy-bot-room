import type { WorldHdDirection } from "./world-hd";
import { worldIsoFacingHoldStart, worldIsoFacingStep, worldIsoGroundFacing, type WorldIsoFacingHold } from "./world-iso-facing";
import { WORLD_ISO_WALK_SPEED } from "./world-iso-gait";
import { WORLD_ISO_FOOTPRINT, worldIsoConnectors, worldIsoGrid, worldIsoPath, worldIsoPlanSealed, worldIsoPointFree, worldIsoRadiusOk, worldIsoSegmentClear, type GroundAnchor, type GroundPlan } from "./world-iso-ground";
import { worldIsoProjection, type GroundPoint, type WorldProjection } from "./world-iso-projection";

/**
 * Living Universe — Isometric Office preview (Step 1b, Stage 2): crowd movement on the ground.
 *
 * Moves up to fifteen characters between anchors of a sealed plan. It only knows ids, ranks and anchors; it
 * holds no Pal identity, memory or permission data. Movement uses the Step 1a engine: routes come from
 * `worldIsoPath`, and every extra segment the crowd invents (side-steps, back-offs) passes the same exact
 * swept-footprint test, so nobody can leave the floor or enter furniture.
 *
 * Rules, in order, on every step:
 * - SPACING. Characters are updated one at a time in rank order. A step is refused if it would bring the
 *   character closer than two footprints (+ a small margin) to anyone it is approaching. Two characters
 *   therefore never overlap, whatever else happens.
 * - RIGHT OF WAY. Higher rank goes first: real work, then Pals, then visitors, then join order.
 * - BLOCKED. A blocked character first looks for another verified route that keeps clear of whoever is in the
 *   way and of everyone standing still. If there is none, the lower-ranked one backs away to make room and
 *   tries again; the higher-ranked one waits.
 * - DESTINATION TAKEN OR UNREACHABLE. It waits a while, then goes to its fallback anchor; if that fails too
 *   it stays where it is ("parked") and reports it. It never waits forever.
 * - DOOR. A character outside enters at the door only when the doorway is clear.
 * - PAUSE / REDUCED MOTION. Paused: nothing changes. Reduced motion: no walking; a character appears at its
 *   destination once that spot is free.
 *
 * Deterministic: the same plan, joins, sends and step sizes give the same positions.
 */
export const WORLD_ISO_CROWD_MAX = 15;
/** Extra gap kept beyond two footprints. */
export const WORLD_ISO_CROWD_MARGIN = 0.02;
const DETOUR_COOLDOWN_MS = 400, DETOUR_AFTER_MS = 600, BACKOFF_AFTER_MS = 1500, DESTINATION_WAIT_MS = 12_000, GIVE_UP_MS = 15_000, MAX_SUBSTEP_MS = 50, MAX_STEP_MS = 250, YIELD_MS = 1500;

export type WorldIsoCrowdStatus = "outside" | "idle" | "walking" | "waiting" | "parked";
export type WorldIsoCrowdActor = Readonly<{
 id: string; present: boolean; u: number; v: number; facing: WorldHdDirection;
 /** True while it actually moved during the last step. */ moving: boolean;
 status: WorldIsoCrowdStatus;
 /** Anchor it stands at (set on arrival, cleared when it leaves). */ at: string | null;
 /** Anchor it is heading for. */ target: string | null;
 /** Total ground distance walked, tiles (drives distance-based walk playback). */ walked: number;
 /** How long it has wanted to move without moving, ms. */ stalledMs: number;
}>;
export type WorldIsoCrowdEvent = Readonly<{ type: "arrived" | "fallback" | "parked" | "entered"; actor: string; anchor: string | null }>;
export type WorldIsoCrowdStats = { pathSearches: number; sideSteps: number; backOffs: number; fallbacks: number; parked: number; longestStallMs: number };
export type WorldIsoCrowdMode = Readonly<{ paused?: boolean; reduced?: boolean }>;
export type WorldIsoCrowd = Readonly<{
 /** Add a character at an anchor, or outside the room (`at: null`). False if refused. */
 join(actor: { id: string; rank: number; at: string | null }): boolean;
 /** Ask a character to go to an anchor, with an optional fallback anchor. False if refused. */
 send(id: string, anchor: string, fallback?: string | null): boolean;
 /** Change a character's rank (for example when real work starts or stops). */
 setRank(id: string, rank: number): void;
 step(dtMs: number, mode?: WorldIsoCrowdMode): void;
 actors(): readonly WorldIsoCrowdActor[];
 /** Events since the last call (cleared on read). */
 drain(): WorldIsoCrowdEvent[];
 stats(): Readonly<WorldIsoCrowdStats>;
}>;

type Actor = {
 id: string; rank: number; order: number; present: boolean; pos: GroundPoint; hold: WorldIsoFacingHold; moving: boolean; status: WorldIsoCrowdStatus;
 at: string | null; target: string | null; fallback: string | null; triedFallback: boolean; path: GroundPoint[]; walked: number;
 blockedMs: number; stalledMs: number; cooldownMs: number; yieldMs: number; clock: number;
};
const dist = (a: GroundPoint, b: GroundPoint) => Math.hypot(a.u - b.u, a.v - b.v);
function pointSegment(p: GroundPoint, a: GroundPoint, b: GroundPoint): number {
 const du = b.u - a.u, dv = b.v - a.v, len = du * du + dv * dv;
 const t = len ? Math.max(0, Math.min(1, ((p.u - a.u) * du + (p.v - a.v) * dv) / len)) : 0;
 return Math.hypot(p.u - (a.u + t * du), p.v - (a.v + t * dv));
}

/** Create a crowd for a sealed plan; null for an unsealed plan, an unsupported radius or speed. */
export function createWorldIsoCrowd(plan: GroundPlan, options: Readonly<{ radius?: number; speed?: number; projection?: WorldProjection }> = {}): WorldIsoCrowd | null {
 const radius = options.radius ?? WORLD_ISO_FOOTPRINT, speed = options.speed ?? WORLD_ISO_WALK_SPEED;
 if (!worldIsoPlanSealed(plan) || !worldIsoRadiusOk(radius) || !Number.isFinite(speed) || speed <= 0 || speed > 10) return null;
 const projection = options.projection ?? worldIsoProjection();
 const anchors = new Map<string, GroundAnchor>(plan.anchors.map(a => [a.id, a]));
 const door = anchors.get(plan.door) ?? null;
 const gap = 2 * radius + WORLD_ISO_CROWD_MARGIN;
 const list: Actor[] = [], byId = new Map<string, Actor>();
 let events: WorldIsoCrowdEvent[] = [];
 const counters: WorldIsoCrowdStats = { pathSearches: 0, sideSteps: 0, backOffs: 0, fallbacks: 0, parked: 0, longestStallMs: 0 };
 const present = (except?: Actor) => list.filter(a => a.present && a !== except);
 const sorted = () => [...list].sort((a, b) => b.rank - a.rank || a.order - b.order);
 const outranks = (a: Actor, b: Actor) => a.rank > b.rank || (a.rank === b.rank && a.order < b.order);
 const clearOfOthers = (a: Actor, p: GroundPoint, extra = 0) => present(a).every(o => dist(o.pos, p) >= gap + extra);
 const route = (from: GroundPoint, to: GroundPoint) => { counters.pathSearches++; return worldIsoPath(plan, from, to, radius); };

 /** Someone staying on (or parked over) the spot `a` wants. A character that is itself about to leave does not count. */
 const occupant = (a: Actor, p: GroundPoint) => present(a).find(o => dist(o.pos, p) < gap && !o.target) ?? null;
 function giveUp(a: Actor) {
  const fallback = a.fallback && a.fallback !== a.target && !a.triedFallback ? a.fallback : null;
  a.path = []; a.blockedMs = 0;
  if (fallback) { a.triedFallback = true; a.target = fallback; counters.fallbacks++; events.push({ type: "fallback", actor: a.id, anchor: fallback }); return; }
  a.target = null; a.status = a.present ? "parked" : "outside"; counters.parked++; events.push({ type: "parked", actor: a.id, anchor: null });
 }
 function arrive(a: Actor, anchor: GroundAnchor) {
  a.pos = { u: anchor.at.u, v: anchor.at.v }; a.path = []; a.at = anchor.id; a.target = null; a.status = "idle"; a.blockedMs = 0; a.stalledMs = 0;
  a.hold = worldIsoFacingStep(a.hold, anchor.facing, a.clock, undefined, true);
  events.push({ type: "arrived", actor: a.id, anchor: anchor.id });
 }
 /** A verified one-segment move to `c` that keeps clear of everyone else along the way. */
 const canStepTo = (a: Actor, c: GroundPoint) =>
  worldIsoPointFree(plan, c, radius) && clearOfOthers(a, c, 0.05) && worldIsoSegmentClear(plan, a.pos, c, radius) && present(a).every(o => pointSegment(o.pos, a.pos, c) >= gap);
 /**
  * Route from `from` to `goal` that also keeps two footprints away from every point in `discs` (characters
  * standing in the way). It searches the Step 1a navigation graph (same nodes, same verified edges, same
  * connectors) and only removes nodes and edges that pass too close to a disc, then string-pulls the result
  * with the exact clearance test. Null when there is no such route.
  */
 function routeAround(from: GroundPoint, goal: GroundPoint, discs: readonly GroundPoint[]): GroundPoint[] | null {
  counters.pathSearches++;
  const g = worldIsoGrid(plan, radius);
  if (!g) return null;
  const open = (p: GroundPoint, q: GroundPoint) => discs.every(d => pointSegment(d, p, q) >= gap);
  const direct = (p: GroundPoint, q: GroundPoint) => open(p, q) && worldIsoSegmentClear(plan, p, q, radius);
  if (direct(from, goal)) return [from, goal];
  const starts = worldIsoConnectors(plan, from, radius).filter(c => open(from, g.point(c.node)));
  const exits = new Map(worldIsoConnectors(plan, goal, radius).filter(c => open(g.point(c.node), goal)).map(c => [c.node, c.cost]));
  if (!starts.length || !exits.size) return null;
  const GOAL = -1, cost = new Map<number, number>(), came = new Map<number, number>(), closed = new Set<number>();
  const h = (id: number) => id === GOAL ? 0 : dist(g.point(id), goal);
  const queue: [number, number][] = []; // small graphs: a sorted insert keeps this simple and deterministic
  const push = (f: number, id: number) => { let i = queue.length; while (i > 0 && (queue[i - 1]![0] > f + 1e-12 || (Math.abs(queue[i - 1]![0] - f) <= 1e-12 && queue[i - 1]![1] > id))) i--; queue.splice(i, 0, [f, id]); };
  const relax = (id: number, next: number, via: number | undefined) => { if (next < (cost.get(id) ?? Infinity) - 1e-12) { cost.set(id, next); if (via === undefined) came.delete(id); else came.set(id, via); push(next + h(id), id); } };
  for (const s of starts) relax(s.node, s.cost, undefined);
  while (queue.length) {
   const [, id] = queue.shift()!;
   if (closed.has(id)) continue;
   if (id === GOAL) break;
   closed.add(id);
   const here = g.point(id), base = cost.get(id)!;
   for (const e of g.neighbours(id)) if (!closed.has(e.to) && open(here, g.point(e.to))) relax(e.to, base + e.cost, id);
   const out = exits.get(id);
   if (out !== undefined) relax(GOAL, base + out, id);
  }
  if (!cost.has(GOAL)) return null;
  const points: GroundPoint[] = [goal];
  for (let id = came.get(GOAL); id !== undefined; id = came.get(id)) points.unshift(g.point(id));
  points.unshift(from);
  const out: GroundPoint[] = [points[0]!];
  for (let i = 0; i < points.length - 1;) { let k = points.length - 1; while (k > i + 1 && !direct(points[i]!, points[k]!)) k--; out.push(points[k]!); i = k; }
  return out;
 }
 /** Re-plan around the blocker and everyone else who is standing still. */
 function sideStep(a: Actor, blocker: Actor, goal: GroundPoint): boolean {
  const discs = present(a).filter(o => o === blocker || !o.path.length || o.status === "waiting").map(o => o.pos);
  if (discs.some(d => dist(d, goal) < gap)) return false; // the destination itself is covered; waiting is handled elsewhere
  const path = routeAround(a.pos, goal, discs);
  if (!path) return false;
  a.path = path.slice(1); counters.sideSteps++;
  return true;
 }
 function backOff(a: Actor, blocker: Actor): boolean {
  let best: GroundPoint | null = null, bestGain = 0.2;
  for (const ring of [1.4, 1.0, 0.7]) for (let k = 0; k < 12; k++) {
   const angle = (k / 12) * 2 * Math.PI, c = { u: a.pos.u + Math.cos(angle) * ring, v: a.pos.v + Math.sin(angle) * ring };
   const gain = dist(c, blocker.pos) - dist(a.pos, blocker.pos);
   if (gain > bestGain + 1e-9 && canStepTo(a, c)) { best = c; bestGain = gain; }
  }
  if (!best) return false;
  a.path = [best]; a.yieldMs = YIELD_MS; counters.backOffs++;
  return true;
 }

 function advance(a: Actor, dt: number, reduced: boolean) {
  a.clock += dt; a.moving = false; a.cooldownMs = Math.max(0, a.cooldownMs - dt);
  if (!a.target) return;
  const anchor = anchors.get(a.target);
  if (!anchor) { giveUp(a); return; }
  const stall = () => { a.status = a.present ? "waiting" : "outside"; a.blockedMs += dt; a.stalledMs += dt; counters.longestStallMs = Math.max(counters.longestStallMs, a.stalledMs); };
  if (reduced) { // no walking: appear at the destination when it is free
   if (clearOfOthers(a, anchor.at)) { a.present = true; arrive(a, anchor); } else { stall(); if (a.blockedMs > DESTINATION_WAIT_MS) giveUp(a); }
   return;
  }
  if (!a.present) { // outside: come in through the door when the doorway is clear
   if (door && clearOfOthers(a, door.at, 0.1)) { a.present = true; a.pos = { u: door.at.u, v: door.at.v }; a.status = "walking"; a.blockedMs = 0; a.hold = worldIsoFacingHoldStart(door.facing, a.clock); events.push({ type: "entered", actor: a.id, anchor: door.id }); }
   else { stall(); if (!door || a.blockedMs > 4 * GIVE_UP_MS) giveUp(a); }
   return;
  }
  if (dist(a.pos, anchor.at) < 1e-6) { arrive(a, anchor); return; }
  if (!a.path.length) {
   if (a.yieldMs > 0) { a.yieldMs -= dt; a.status = "waiting"; a.stalledMs += dt; counters.longestStallMs = Math.max(counters.longestStallMs, a.stalledMs); return; } // stepped aside: let the other pass
   const taken = occupant(a, anchor.at);
   if (taken) { stall(); if (a.blockedMs > DESTINATION_WAIT_MS) giveUp(a); return; }
   const path = route(a.pos, anchor.at);
   if (!path) { giveUp(a); return; }
   a.path = path.slice(1);
  }
  let budget = speed * dt / 1000;
  while (budget > 1e-9 && a.path.length) {
   const next = a.path[0]!, d = dist(a.pos, next), stepLength = Math.min(budget, d);
   const c = d <= 1e-9 ? next : { u: a.pos.u + (next.u - a.pos.u) * stepLength / d, v: a.pos.v + (next.v - a.pos.v) * stepLength / d };
   const blocker = present(a).find(o => { const now = dist(o.pos, a.pos), then = dist(o.pos, c); return then < gap && then < now - 1e-12; });
   if (blocker) {
    stall();
    const blockerStill = !blocker.path.length || blocker.status === "waiting";
    if (a.cooldownMs <= 0 && (blockerStill || !outranks(a, blocker) || a.blockedMs > DETOUR_AFTER_MS)) {
     a.cooldownMs = DETOUR_COOLDOWN_MS;
     if (sideStep(a, blocker, anchor.at)) { a.blockedMs = 0; return; }
     if (!outranks(a, blocker) && a.blockedMs > BACKOFF_AFTER_MS && backOff(a, blocker)) { a.blockedMs = 0; return; }
    }
    if (a.blockedMs > GIVE_UP_MS) giveUp(a);
    return;
   }
   if (stepLength > 1e-9) {
    a.hold = worldIsoFacingStep(a.hold, worldIsoGroundFacing(projection, a.pos, c, a.hold.shown), a.clock);
    a.pos = c; a.walked += stepLength; a.moving = true; a.at = null; a.status = "walking"; a.blockedMs = 0; a.stalledMs = 0;
   }
   budget -= stepLength;
   if (dist(a.pos, next) <= 1e-9) { a.pos = { u: next.u, v: next.v }; a.path.shift(); }
  }
  if (!a.path.length && dist(a.pos, anchor.at) < 1e-6) arrive(a, anchor);
 }

 return Object.freeze({
  join({ id, rank, at }: { id: string; rank: number; at: string | null }) {
   if (typeof id !== "string" || byId.has(id) || list.length >= WORLD_ISO_CROWD_MAX || !Number.isFinite(rank)) return false;
   const anchor = at === null ? null : anchors.get(at);
   if (at !== null && (!anchor || !worldIsoPointFree(plan, anchor.at, radius) || !list.every(o => !o.present || dist(o.pos, anchor.at) >= gap))) return false;
   const a: Actor = {
    id, rank, order: list.length, present: !!anchor, pos: anchor ? { u: anchor.at.u, v: anchor.at.v } : { u: Number.NaN, v: Number.NaN }, hold: worldIsoFacingHoldStart(anchor?.facing ?? "s"),
    moving: false, status: anchor ? "idle" : "outside", at: anchor?.id ?? null, target: null, fallback: null, triedFallback: false, path: [], walked: 0, blockedMs: 0, stalledMs: 0, cooldownMs: 0, yieldMs: 0, clock: 0,
   };
   list.push(a); byId.set(id, a);
   return true;
  },
  send(id: string, anchor: string, fallback: string | null = null) {
   const a = byId.get(id);
   if (!a || !anchors.has(anchor) || (fallback !== null && !anchors.has(fallback))) return false;
   if (a.target === anchor || (a.at === anchor && !a.target)) { a.fallback = fallback; return true; }
   a.target = anchor; a.fallback = fallback; a.triedFallback = false; a.path = []; a.blockedMs = 0;
   if (a.present) a.status = "walking";
   return true;
  },
  setRank(id: string, rank: number) { const a = byId.get(id); if (a && Number.isFinite(rank)) a.rank = rank; },
  step(dtMs: number, mode: WorldIsoCrowdMode = {}) {
   if (mode.paused || !Number.isFinite(dtMs) || dtMs <= 0) return;
   let left = Math.min(dtMs, MAX_STEP_MS);
   while (left > 1e-9) {
    const dt = Math.min(left, MAX_SUBSTEP_MS);
    for (const a of sorted()) advance(a, dt, mode.reduced === true);
    left -= dt;
   }
  },
  actors: () => list.map(a => Object.freeze({ id: a.id, present: a.present, u: a.pos.u, v: a.pos.v, facing: a.hold.shown, moving: a.moving, status: a.status, at: a.at, target: a.target, walked: a.walked, stalledMs: a.stalledMs })),
  drain() { const out = events; events = []; return out; },
  stats: () => ({ ...counters }),
 });
}

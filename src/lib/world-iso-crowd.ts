import type { WorldHdDirection } from "./world-hd";
import type { GroundPlan } from "./world-iso-ground";
import type { GroundPoint } from "./world-iso-projection";
import { WORLD_ISO_FOOTPRINT, worldIsoPath, worldIsoPlanSealed, worldIsoPointFree, worldIsoRadiusOk, worldIsoSegmentClear, worldIsoSegmentDistance } from "./world-iso-ground";
import { worldIsoGroundFacing } from "./world-iso-facing";
import { WORLD_ISO_WALK_SPEED } from "./world-iso-gait";
import { WORLD_ISO_GREYBOX } from "./world-iso-greybox";
import { worldIsoProjection } from "./world-iso-projection";

export type WorldIsoCrowdJoin = Readonly<{
 id: string; kind: "pal" | "visitor"; at: GroundPoint; facing?: WorldHdDirection;
 /** Authoritative real-work flag, passed by the parent; it never originates in ambient scheduling. */
 real?: boolean;
}>;
export type WorldIsoCrowdStatus = "arrived" | "moving" | "waiting" | "yielding" | "blocked" | "unreachable";
export type WorldIsoCrowdPose = Readonly<{
 id: string; kind: "pal" | "visitor"; at: GroundPoint; facing: WorldHdDirection;
 walking: boolean; waiting: boolean; walked: number;
 status: WorldIsoCrowdStatus; waitMs: number;
}>;
export type WorldIsoCrowdDiagnostics = Readonly<{
 ticks: number; simulatedMs: number; droppedMs: number; pathQueries: number; failedAssignments: number;
 recoveryAttempts: number; moves: number; maxWaitMs: number;
 actors: readonly Readonly<{ id: string; status: WorldIsoCrowdStatus; waitMs: number; goal: GroundPoint; arrived: boolean; reason: string | null }>[];
}>;
type MutableActor = {
 id: string; kind: "pal" | "visitor"; at: GroundPoint; facing: WorldHdDirection; real: boolean;
 goal: GroundPoint; path: GroundPoint[]; waypoint: number; walking: boolean; waiting: boolean; walked: number;
 status: WorldIsoCrowdStatus; waitMs: number; reason: string | null;
 yieldTo: GroundPoint | null; yieldHoldMs: number; failedGoal: GroundPoint | null; failedAt: number;
};
const distance = (a: GroundPoint, b: GroundPoint) => Math.hypot(a.u - b.u, a.v - b.v);
const copy = (p: GroundPoint): GroundPoint => ({ u: p.u, v: p.v });
const EPS = 1e-8;
const MAX_ACTORS = 15;
const SLICE_MS = 50;
const MAX_UPDATE_MS = 200;
const WAIT_LIMIT_MS = 25_000;
const YIELD_HOLD_MS = 1_500;
const RECOVER_AFTER_MS = 300;
const REPLAN_AFTER_MS = 2_000;
const MAX_RECOVERIES_PER_UPDATE = 2;
const projection = worldIsoProjection();

/**
 * Isolated deterministic ground-space reservation simulation.
 * Real movement follows verified path segments; each substep reserves every actor's old
 * position and every already committed polyline. A blocked move NEVER skips an obstacle.
 * A lower-priority actor may sidestep to a free temporary point, hold there to let the
 * other pass, then retry its original goal. When no legal sidestep exists it reports a
 * blocked goal and retries on a bounded cadence; no false claim of guaranteed liveness.
 *
 * Caller policy: render/assign at most 15 actors. Each step consumes at most 200ms of
 * simulated movement in 50ms slices; excess time is dropped, not caught up in a burst.
 */
export class WorldIsoCrowd {
 readonly plan: GroundPlan;
 readonly radius: number;
 private actors = new Map<string, MutableActor>();
 private counters = { ticks: 0, simulatedMs: 0, droppedMs: 0, pathQueries: 0, failedAssignments: 0, recoveryAttempts: 0, moves: 0, maxWaitMs: 0 };
 private time = 0;

 constructor(plan: GroundPlan = WORLD_ISO_GREYBOX, radius = WORLD_ISO_FOOTPRINT) {
  if (!worldIsoPlanSealed(plan) || !worldIsoRadiusOk(radius))
   throw new RangeError("Crowd requires a sealed ground plan and a supported footprint.");
  this.plan = plan; this.radius = radius;
 }
 private rank(a: MutableActor): number { return a.kind === "pal" ? (a.real ? 3 : 2) : 1; }
 private ordered(): MutableActor[] {
  return [...this.actors.values()].sort((a, b) => this.rank(b) - this.rank(a) || a.id.localeCompare(b.id));
 }
 join(input: WorldIsoCrowdJoin): boolean {
  if (!input || typeof input.id !== "string" || !input.id ||
   (input.kind !== "pal" && input.kind !== "visitor") ||
   this.actors.has(input.id) || this.actors.size >= MAX_ACTORS ||
   !worldIsoPointFree(this.plan, input.at, this.radius)) return false;
  if ([...this.actors.values()].some(a => distance(a.at, input.at) < 2 * this.radius - EPS)) return false;
  const at = copy(input.at);
  this.actors.set(input.id, { id: input.id, kind: input.kind, at, real: input.real === true,
   goal: copy(at), path: [copy(at)], waypoint: 1, facing: input.facing ?? "s",
   walking: false, waiting: false, walked: 0, status: "arrived", waitMs: 0, reason: null,
   yieldTo: null, yieldHoldMs: 0, failedGoal: null, failedAt: -Infinity });
  return true;
 }
 leave(id: string): void { this.actors.delete(id); }
 ids(): string[] { return [...this.actors.keys()].sort(); }
 setReal(id: string, real: boolean): void { const a = this.actors.get(id); if (a) a.real = real === true; }

 /** A failed static route never destroys a previous valid goal. Repeated failed requests are cached. */
 assign(id: string, target: GroundPoint): boolean {
  const a = this.actors.get(id);
  if (!a) return false;
  if (!worldIsoPointFree(this.plan, target, this.radius)) {
   a.reason = "invalid-ground"; a.status = "unreachable"; a.failedGoal = copy(target); a.failedAt = this.time;
   this.counters.failedAssignments++; return false;
  }
  if (distance(target, a.goal) < EPS) return true;
  if (a.failedGoal && distance(target, a.failedGoal) < EPS && this.time - a.failedAt < REPLAN_AFTER_MS) return false;
  // An already-held target cannot be occupied by two stationary actors.
  const occupied = [...this.actors.values()].some(b => b.id !== id &&
   (distance(target, b.goal) < 2 * this.radius - EPS || (distance(target, b.at) < 2 * this.radius - EPS && distance(b.goal, b.at) < EPS)));
  if (occupied) {
   a.reason = "destination-reserved"; a.status = "blocked"; a.failedGoal = copy(target); a.failedAt = this.time;
   this.counters.failedAssignments++; return false;
  }
  this.counters.pathQueries++;
  const path = worldIsoPath(this.plan, a.at, target, this.radius);
  if (!path) {
   a.reason = "no-static-route"; a.status = "unreachable"; a.failedGoal = copy(target); a.failedAt = this.time;
   this.counters.failedAssignments++; return false;
  }
  a.goal = copy(target); a.path = path; a.waypoint = 1; a.reason = null;
  a.failedGoal = null; a.failedAt = -Infinity; a.waitMs = 0; a.yieldTo = null; a.yieldHoldMs = 0;
  a.status = distance(a.at, target) < EPS ? "arrived" : "moving"; a.waiting = false;
  return true;
 }
 pose(id: string): WorldIsoCrowdPose | null {
  const a = this.actors.get(id);
  return a ? { id: a.id, kind: a.kind, at: copy(a.at), facing: a.facing, walking: a.walking,
   waiting: a.waiting, walked: a.walked, status: a.status, waitMs: a.waitMs } : null;
 }
 snapshot(): WorldIsoCrowdPose[] { return this.ids().map(id => this.pose(id)!); }
 diagnostics(): WorldIsoCrowdDiagnostics {
  return { ...this.counters, actors: this.ids().map(id => {
   const a = this.actors.get(id)!;
   return { id, status: a.status, waitMs: a.waitMs, goal: copy(a.goal),
    arrived: distance(a.at, a.goal) < EPS, reason: a.reason };
  }) };
 }
 /** Do not count a safe, immobile actor as having arrived unless at its requested goal. */
 valid(): boolean {
  const list = [...this.actors.values()];
  return list.every(a => worldIsoPointFree(this.plan, a.at, this.radius)) &&
   list.every((a, i) => list.slice(i + 1).every(b => distance(a.at, b.at) >= 2 * this.radius - EPS));
 }
 private clearAgainstActors(
  a: MutableActor, from: GroundPoint, to: GroundPoint,
  old: Map<string, GroundPoint>, trails: Map<string, GroundPoint[]>,
 ): MutableActor | null {
  for (const b of this.ordered()) {
   if (a.id === b.id) continue;
   const points = [old.get(b.id)!, ...(trails.get(b.id) ?? [])];
   if (points.length === 1) {
    if (worldIsoSegmentDistance(from, to, points[0]!, points[0]!) < 2 * this.radius - EPS) return b;
   } else {
    for (let i = 1; i < points.length; i++)
     if (worldIsoSegmentDistance(from, to, points[i - 1]!, points[i]!) < 2 * this.radius - EPS) return b;
   }
  }
  return null;
 }
 /**
  * Direct, short side-step candidates only. No unbounded dynamic A* calls.
  * The yield direction prefers the right-hand side of travel and then the left;
  * reversing the order for alternating identities avoids symmetric gridlock.
  */
 private tryYield(a: MutableActor, blocker: MutableActor, old: Map<string, GroundPoint>, trails: Map<string, GroundPoint[]>): boolean {
  this.counters.recoveryAttempts++;
  const du = a.goal.u - a.at.u, dv = a.goal.v - a.at.v;
  const length = Math.hypot(du, dv) || 1;
  const x = du / length, y = dv / length;
  const signs = a.id.localeCompare(blocker.id) < 0 ? [1, -1] : [-1, 1];
  const awayU = a.at.u - blocker.at.u, awayV = a.at.v - blocker.at.v;
  const awayLen = Math.hypot(awayU, awayV) || 1;
  for (const factor of [1.5, 2.5]) for (const sign of signs) {
   const candidate = { u: a.at.u + sign * -y * this.radius * factor + awayU / awayLen * 0.15,
    v: a.at.v + sign * x * this.radius * factor + awayV / awayLen * 0.15 };
   if (!worldIsoSegmentClear(this.plan, a.at, candidate, this.radius)) continue;
   if (this.clearAgainstActors(a, a.at, candidate, old, trails)) continue;
   a.yieldTo = candidate;
   a.yieldHoldMs = YIELD_HOLD_MS; a.status = "yielding"; a.reason = "yield-to:" + blocker.id;
   return true;
  }
  return false;
 }
 /** One fixed, bounded simulation slice; advances over each actual path leg, never a corner-cutting chord. */
 private slice(ms: number, recoverBudget: { left: number }): void {
  const ordered = this.ordered();
  const old = new Map(ordered.map(a => [a.id, copy(a.at)]));
  const trails = new Map<string, GroundPoint[]>();
  for (const a of ordered) {
   a.walking = false; a.waiting = false;
   if (a.yieldTo && distance(a.at, a.yieldTo) < EPS) {
    a.yieldHoldMs -= ms;
    if (a.yieldHoldMs > 0) { a.status = "yielding"; continue; }
    // Replan only when a recovery slot is available; never follow stale
    // waypoints from the old location while off the original route.
    if (recoverBudget.left === 0) { a.status = "yielding"; continue; }
    recoverBudget.left--; this.counters.pathQueries++;
    const newPath = worldIsoPath(this.plan, a.at, a.goal, this.radius);
    a.yieldTo = null;
    if (newPath) { a.path = newPath; a.waypoint = 1; a.reason = null; }
    else { a.reason = "no-route-after-yield"; a.status = "unreachable"; }
   }
   if (a.status === "unreachable" && !a.yieldTo) continue;
   const original = copy(a.at);
   const distanceBudget = ms / 1000 * WORLD_ISO_WALK_SPEED;
   let remaining = distanceBudget, blocker: MutableActor | null = null;
   let moved = 0;
   const intended = a.yieldTo ? [a.at, a.yieldTo] : a.path;
   let atIndex = a.yieldTo ? 1 : a.waypoint;
   let current = copy(a.at), walked = 0;
   const pathTrail: GroundPoint[] = [];
   // A single bounded slice can traverse several short segments, never more than 64.
   for (let segment = 0; segment < 64 && remaining > EPS && atIndex < intended.length; segment++) {
    const dest = intended[atIndex]!;
    const len = distance(current, dest);
    if (len <= EPS) { atIndex++; continue; }
    const take = Math.min(remaining, len);
    const next = { u: current.u + (dest.u - current.u) * take / len,
     v: current.v + (dest.v - current.v) * take / len };
    if (!worldIsoSegmentClear(this.plan, current, next, this.radius)) {
     a.reason = "static-clearance"; a.status = "blocked"; break;
    }
    blocker = this.clearAgainstActors(a, current, next, old, trails);
    if (blocker) break;
    pathTrail.push(copy(next));
    current = next; walked += take; moved++; remaining -= take;
    if (take >= len - EPS) atIndex++;
   }
   if (walked > EPS) {
    a.facing = worldIsoGroundFacing(projection, original, pathTrail[0]!, a.facing);
    a.at = current; a.walked += walked; a.walking = true; a.waitMs = 0;
    this.counters.moves += moved;
    trails.set(a.id, pathTrail);
    if (!a.yieldTo) a.waypoint = atIndex;
    a.status = a.yieldTo ? "yielding" : (distance(a.at, a.goal) < EPS ? "arrived" : "moving");
   }
   if (blocker) {
    a.waiting = true; a.waitMs += ms; a.reason = "actor:" + blocker.id;
    this.counters.maxWaitMs = Math.max(this.counters.maxWaitMs, a.waitMs);
    if (!a.yieldTo && a.waitMs >= RECOVER_AFTER_MS && recoverBudget.left > 0) {
     const lower = this.rank(a) < this.rank(blocker) ||
      (this.rank(a) === this.rank(blocker) && a.id > blocker.id);
     if (lower || a.waitMs >= REPLAN_AFTER_MS) {
      recoverBudget.left--;
      this.tryYield(a, blocker, old, trails);
     }
    }
    if (!a.yieldTo) a.status = a.waitMs >= WAIT_LIMIT_MS ? "blocked" : "waiting";
   } else if (walked <= EPS && !a.yieldTo && distance(a.at, a.goal) < EPS) {
    a.status = "arrived"; a.waitMs = 0;
   }
  }
 }
 /**
  * Partition ordinary dt calls into 50ms-or-smaller slices. A >200ms throttled
  * frame discards excess elapsed time (never fast-forwards through a crowd).
  */
 step(dtMs: number, paused = false): void {
  if (paused || !Number.isFinite(dtMs) || dtMs <= 0) {
   for (const a of this.actors.values()) { a.walking = false; a.waiting = false; }
   return;
  }
  const bounded = Math.min(dtMs, MAX_UPDATE_MS);
  this.counters.droppedMs += Math.max(0, dtMs - bounded);
  this.counters.ticks++;
  const budget = { left: MAX_RECOVERIES_PER_UPDATE };
  let remaining = bounded;
  while (remaining > EPS) {
   const duration = Math.min(SLICE_MS, remaining);
   this.slice(duration, budget);
   remaining -= duration; this.time += duration; this.counters.simulatedMs += duration;
  }
 }
}

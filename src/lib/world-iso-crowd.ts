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
export type WorldIsoGoalOutcome = "pending" | "completed" | "rejected" | "unreachable" | "canceled" | "stalled";
export type WorldIsoGoalDiagnostics = {
 actorId: string; sequence: number; requested: GroundPoint | null;
 requestAtMs: number; reservationAtMs: number | null; arrivalAtMs: number | null; finishedAtMs: number | null;
 blockedMs: number; continuousBlockedMs: number; maxContinuousBlockedMs: number;
 yieldingMs: number; recoveryAttempts: number; nonProgressMs: number; maxNonProgressMs: number;
 lastProgressAtMs: number; bestDistance: number;
 outcome: WorldIsoGoalOutcome; reason: string | null;
};
export type WorldIsoCrowdDiagnostics = Readonly<{
 ticks: number; simulatedMs: number; droppedMs: number; pathQueries: number; failedAssignments: number;
 recoveryAttempts: number; moves: number; maxWaitMs: number; goalHistoryTruncated: number;
 actors: readonly Readonly<{
  id: string; status: WorldIsoCrowdStatus; waitMs: number; goal: GroundPoint;
  requestedGoal: GroundPoint | null; reserved: boolean; goalAgeMs: number;
  arrived: boolean; reason: string | null;
 }>[];
 goals: readonly WorldIsoGoalDiagnostics[];
}>;
type MutableActor = {
 id: string; kind: "pal" | "visitor"; at: GroundPoint; facing: WorldHdDirection; real: boolean;
 goal: GroundPoint; path: GroundPoint[]; waypoint: number; walking: boolean; waiting: boolean; walked: number; committed: boolean;
 status: WorldIsoCrowdStatus; waitMs: number; reason: string | null;
 yieldTo: GroundPoint | null; yieldHoldMs: number; failedGoal: GroundPoint | null; failedAt: number;
 goalRecord: WorldIsoGoalDiagnostics | null;
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
const MAX_GOAL_HISTORY = 4096;
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
 private goals: WorldIsoGoalDiagnostics[] = [];
 private nextGoalSequence = 0;
 private goalHistoryTruncated = 0;

 private cancelGoal(a: MutableActor, reason: string): void {
  const goal = a.goalRecord;
  if (goal && (goal.outcome === "pending" || goal.outcome === "stalled")) {
   goal.outcome = "canceled"; goal.reason = reason; goal.finishedAtMs = this.time;
  }
 }
 private startGoal(a: MutableActor, requested: GroundPoint | null): WorldIsoGoalDiagnostics {
  this.cancelGoal(a, "superseded-by-assignment");
  const goal: WorldIsoGoalDiagnostics = {
   actorId: a.id, sequence: ++this.nextGoalSequence, requested: requested ? copy(requested) : null,
   requestAtMs: this.time, reservationAtMs: null, arrivalAtMs: null, finishedAtMs: null,
   blockedMs: 0, continuousBlockedMs: 0, maxContinuousBlockedMs: 0,
   yieldingMs: 0, recoveryAttempts: 0, nonProgressMs: 0, maxNonProgressMs: 0,
   lastProgressAtMs: this.time,
   bestDistance: requested ? distance(a.at, requested) : Infinity,
   outcome: "pending", reason: null,
  };
  a.goalRecord = goal; this.goals.push(goal);
  if (this.goals.length > MAX_GOAL_HISTORY) { this.goals.shift(); this.goalHistoryTruncated++; }
  return goal;
 }

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
   walking: false, waiting: false, walked: 0, committed: false, status: "arrived", waitMs: 0, reason: null,
   yieldTo: null, yieldHoldMs: 0, failedGoal: null, failedAt: -Infinity, goalRecord: null });
  return true;
 }
 leave(id: string): void {
  const a = this.actors.get(id);
  if (a) { this.cancelGoal(a, "roster-left"); this.actors.delete(id); }
 }
 ids(): string[] { return [...this.actors.keys()].sort(); }
 setReal(id: string, real: boolean): void { const a = this.actors.get(id); if (a) a.real = real === true; }
 /**
  * Release the previous ambient period's tentative destination claims
  * before assigning the new period. This prevents stale claims from blocking
  * an actor whose target is being vacated. Real-work seats remain reserved.
  * The physical actor footprints are still protected by swept checks.
  */
 beginSchedulePeriod(): void {
  for (const a of this.actors.values()) if (!a.real) a.committed = false;
 }

 /**
  * Safe destination assignment. Initial join locations do not reserve a
  * future destination until explicitly assigned; this preserves legacy
  * head-on exchange semantics. Failed assignments stop the obsolete route,
  * keep the requested target visible as blocked/unreachable, and retry on
  * a bounded 2-second cadence without searching every animation frame.
  */
 assign(id: string, target: GroundPoint): boolean {
  const a = this.actors.get(id);
  if (!a) return false;
  const numericTarget = !!target && typeof target.u === "number" && typeof target.v === "number"
   && Number.isFinite(target.u) && Number.isFinite(target.v);
  const requested = numericTarget ? copy(target) : null;
  const same = !!requested && !!a.goalRecord?.requested &&
   distance(requested, a.goalRecord.requested) < EPS;
  const goal = same ? a.goalRecord! : this.startGoal(a, requested);
  // A duplicate request must neither reset an intercepted yield nor erase
  // its original request time, blocked duration, or recovery attempts.
  if (same && a.committed && !a.failedGoal) {
   // A repeated goal is not authorization to retain a stale yielding route.
   // A third actor can intercept a sidestep between calls to step().
   if (a.yieldTo) {
    const positions = new Map(this.ordered().map(b => [b.id, copy(b.at)]));
    const blocker = this.clearAgainstActors(a, a.at, a.yieldTo, positions, new Map());
    if (!worldIsoSegmentClear(this.plan, a.at, a.yieldTo, this.radius) || blocker) {
     a.yieldTo = null; a.yieldHoldMs = 0;
     a.status = "blocked"; a.reason = "yield-route-obstructed";
     this.counters.pathQueries++;
     const reroute = worldIsoPath(this.plan, a.at, a.goal, this.radius);
     if (reroute) { a.path = reroute; a.waypoint = 1; }
     else {
      a.committed = false; a.status = "unreachable";
      a.reason = "no-route-after-interception";
      goal.outcome = "unreachable"; goal.reason = a.reason;
      goal.finishedAtMs = this.time;
      a.failedGoal = copy(a.goal); a.failedAt = this.time;
      return false;
     }
    }
   }
   return true;
  }
  if (same && a.failedGoal && this.time - a.failedAt < REPLAN_AFTER_MS) return false;
  const fail = (reason: string, status: WorldIsoCrowdStatus) => {
   a.goal = requested ? copy(requested) : copy(a.at);
   a.path = [copy(a.at)]; a.waypoint = 1;
   a.yieldTo = null; a.yieldHoldMs = 0;
   a.waiting = false; a.walking = false; a.status = status; a.reason = reason;
   a.failedGoal = requested ? copy(requested) : null; a.failedAt = this.time;
   // A rejected request never owns a reservation. Reassignment releases
   // the previous claim immediately even when the new request fails.
   a.committed = false;
   goal.reservationAtMs = null; goal.arrivalAtMs = null; goal.finishedAtMs = this.time;
   goal.outcome = reason === "destination-reserved" ? "rejected" : "unreachable";
   goal.reason = reason;
   this.counters.failedAssignments++; return false;
  };
  if (!requested) return fail("invalid-coordinate", "unreachable");
  if (!worldIsoPointFree(this.plan, requested, this.radius))
   return fail("invalid-ground", "unreachable");
  const reserved = [...this.actors.values()].some(b => b.id !== id && b.committed &&
   distance(requested, b.goal) < 2 * this.radius - EPS);
  if (reserved) return fail("destination-reserved", "blocked");
  this.counters.pathQueries++;
  const path = worldIsoPath(this.plan, a.at, requested, this.radius);
  if (!path) return fail("no-static-route", "unreachable");
  a.goal = copy(requested); a.path = path; a.waypoint = 1; a.reason = null;
  a.committed = true; a.failedGoal = null; a.failedAt = -Infinity;
  a.waitMs = 0; a.yieldTo = null; a.yieldHoldMs = 0;
  a.status = distance(a.at, requested) < EPS ? "arrived" : "moving";
  a.waiting = false;
  if (goal.reservationAtMs === null) goal.reservationAtMs = this.time;
  // Re-reserving the same goal after an ambient-period release or retry is
  // not permission to restart its historical no-progress/blocked clock.
  if (!same) {
   goal.lastProgressAtMs = this.time; goal.nonProgressMs = 0;
   goal.bestDistance = distance(a.at, requested);
  }
  const reached = a.status === "arrived";
  goal.outcome = reached ? "completed" : "pending";
  // A repeat reservation at an already reached destination is not a new
  // logical completion; preserve its first successful arrival timestamp.
  if (reached) {
   if (goal.arrivalAtMs === null) goal.arrivalAtMs = this.time;
   if (goal.finishedAtMs === null) goal.finishedAtMs = this.time;
  } else { goal.arrivalAtMs = null; goal.finishedAtMs = null; }
  goal.reason = null;
  return true;
 }
 pose(id: string): WorldIsoCrowdPose | null {
  const a = this.actors.get(id);
  return a ? { id: a.id, kind: a.kind, at: copy(a.at), facing: a.facing, walking: a.walking,
   waiting: a.waiting, walked: a.walked, status: a.status, waitMs: a.waitMs } : null;
 }
 snapshot(): WorldIsoCrowdPose[] { return this.ids().map(id => this.pose(id)!); }
 diagnostics(): WorldIsoCrowdDiagnostics {
  return { ...this.counters, goalHistoryTruncated: this.goalHistoryTruncated,
   actors: this.ids().map(id => {
    const a = this.actors.get(id)!;
    const goal = a.goalRecord;
    return { id, status: a.status, waitMs: a.waitMs, goal: copy(a.goal),
     requestedGoal: goal?.requested ? copy(goal.requested) : null,
     reserved: a.committed, goalAgeMs: goal ? this.time - goal.requestAtMs : 0,
     arrived: a.committed && a.status === "arrived" && !!goal &&
      goal.outcome === "completed" && !!goal.requested &&
      distance(a.at, goal.requested) < EPS,
     reason: a.reason };
   }),
   goals: this.goals.map(g => ({ ...g, requested: g.requested ? copy(g.requested) : null })),
  };
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
  if (a.goalRecord) a.goalRecord.recoveryAttempts++;
  const du = a.goal.u - a.at.u, dv = a.goal.v - a.at.v;
  const length = Math.hypot(du, dv) || 1;
  const x = du / length, y = dv / length;
  const signs = a.id.localeCompare(blocker.id) < 0 ? [1, -1] : [-1, 1];
  const awayU = a.at.u - blocker.at.u, awayV = a.at.v - blocker.at.v;
  const awayLen = Math.hypot(awayU, awayV) || 1;
  const away = {u:awayU/awayLen,v:awayV/awayLen};
  // First choice is a full clearance lane, not a cosmetic 0.45-tile
  // side-step that leaves the actor obstructing a 0.6-tile diameter lane.
  // All candidates are statically/dynamically swept-tested and the search
  // is bounded (3 distances × 8 directions). No shortcut/teleport.
  const directions = [
   ...signs.map(sign => ({u:-y*sign,v:x*sign})),
   away,
   {u:-x,v:-y},
   ...signs.map(sign => ({u:(away.u-y*sign)*Math.SQRT1_2,v:(away.v+x*sign)*Math.SQRT1_2})),
   {u:-away.v,v:away.u},
   {u:away.v,v:-away.u},
  ];
  for (const factor of [2.5, 3.5, 5]) for (const dir of directions) {
   const candidate = { u: a.at.u + dir.u * this.radius * factor + away.u * 0.10,
    v: a.at.v + dir.v * this.radius * factor + away.v * 0.10 };
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
    if (newPath) { a.path = newPath; a.waypoint = 1; a.reason = null; a.status = "moving"; }
    else {
     a.reason = "no-route-after-yield"; a.status = "unreachable";
     if (a.goalRecord) { a.goalRecord.outcome = "unreachable"; a.goalRecord.reason = a.reason;
      a.goalRecord.finishedAtMs = this.time + ms; }
    }
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
    if (!a.yieldTo) {
     a.waypoint = atIndex;
     if (a.goalRecord) {
      const closer = distance(a.at, a.goal);
      if (closer < a.goalRecord.bestDistance - 0.01) {
       a.goalRecord.bestDistance = closer;
       a.goalRecord.lastProgressAtMs = this.time + ms;
      }
     }
    }
    a.status = a.yieldTo ? "yielding" : (distance(a.at, a.goal) < EPS ? "arrived" : "moving");
   }
   if (blocker) {
    a.waiting = true; a.waitMs += ms; a.reason = "actor:" + blocker.id;
    this.counters.maxWaitMs = Math.max(this.counters.maxWaitMs, a.waitMs);
    if (a.yieldTo && recoverBudget.left > 0) {
     // A third actor can intercept a sidestep after it was selected.
     // Invalidate that route and use one bounded recovery slot to find
     // another statically and dynamically swept-clear destination.
     const stale = a.yieldTo;
     recoverBudget.left--;
     a.yieldTo = null; a.yieldHoldMs = 0;
     if (!this.tryYield(a, blocker, old, trails) ||
      (a.yieldTo && distance(a.yieldTo, stale) < EPS)) {
      a.yieldTo = null; a.yieldHoldMs = 0;
      a.status = "blocked"; a.reason = "yield-intercepted:" + blocker.id;
      // The original waypoints can now start off-path; plan from the
      // current physical position rather than traversing a stale chord.
      this.counters.pathQueries++;
      const replanned = worldIsoPath(this.plan, a.at, a.goal, this.radius);
      if (replanned) { a.path = replanned; a.waypoint = 1; }
      else {
       a.status = "unreachable"; a.reason = "no-route-after-interception";
       if (a.goalRecord) {
        a.goalRecord.outcome = "unreachable"; a.goalRecord.reason = a.reason;
        a.goalRecord.finishedAtMs = this.time + ms;
       }
      }
     }
    } else if (!a.yieldTo && a.waitMs >= RECOVER_AFTER_MS && recoverBudget.left > 0) {
     const lower = this.rank(a) < this.rank(blocker) ||
      (this.rank(a) === this.rank(blocker) && a.id > blocker.id);
     if (lower || a.waitMs >= REPLAN_AFTER_MS) {
      recoverBudget.left--;
      this.tryYield(a, blocker, old, trails);
     }
    }
    if (!a.yieldTo && a.status !== "unreachable")
     a.status = a.waitMs >= WAIT_LIMIT_MS ? "blocked" :
      (a.reason?.startsWith("yield-intercepted:") ? "blocked" : "waiting");
   } else if (walked <= EPS && !a.yieldTo && a.committed &&
    a.status !== "unreachable" && distance(a.at, a.goal) < EPS) {
    a.status = "arrived"; a.waitMs = 0;
   }
  }
  // These clocks belong to logical requests, never to retry/yield timers.
  // Yielding movement does not reset the no-goal-progress clock.
  for (const a of ordered) {
   const goal = a.goalRecord;
   if (!goal || goal.outcome === "completed" || goal.outcome === "canceled") continue;
   const rejected = goal.outcome === "rejected" || goal.outcome === "unreachable";
   if (!rejected && a.committed && a.status === "arrived" && goal.requested &&
    distance(a.at, goal.requested) < EPS) {
    goal.outcome = "completed"; goal.arrivalAtMs = this.time + ms;
    goal.finishedAtMs = this.time + ms;
    goal.nonProgressMs = 0; goal.continuousBlockedMs = 0; goal.reason = null;
    continue;
   }
   const blocked = a.waiting || a.status === "yielding" ||
    a.status === "blocked" || a.status === "unreachable";
   if (a.status === "yielding") goal.yieldingMs += ms;
   if (blocked) {
    goal.blockedMs += ms; goal.continuousBlockedMs += ms;
    goal.maxContinuousBlockedMs = Math.max(goal.maxContinuousBlockedMs, goal.continuousBlockedMs);
   } else goal.continuousBlockedMs = 0;
   goal.nonProgressMs = Math.max(0, this.time + ms - goal.lastProgressAtMs);
   goal.maxNonProgressMs = Math.max(goal.maxNonProgressMs, goal.nonProgressMs);
   // Rejected or statically impossible held requests also accumulate honest
   // unresolved blockage time; they are never reclassified as arrivals.
   if (rejected) { goal.finishedAtMs = this.time + ms; continue; }
   if (blocked && goal.nonProgressMs >= WAIT_LIMIT_MS) {
    goal.outcome = "stalled"; goal.reason = "goal-progress-timeout";
    goal.finishedAtMs = this.time + ms;
    a.yieldTo = null; a.yieldHoldMs = 0;
    a.status = "blocked"; a.reason = goal.reason;
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

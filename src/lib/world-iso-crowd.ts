import type { WorldHdDirection } from "./world-hd";
import type { GroundPlan } from "./world-iso-ground";
import type { GroundPoint } from "./world-iso-projection";
import { WORLD_ISO_FOOTPRINT, worldIsoPath, worldIsoPlanSealed, worldIsoPointFree, worldIsoRadiusOk, worldIsoSegmentClear, worldIsoSegmentDistance } from "./world-iso-ground";
import { worldIsoGroundFacing } from "./world-iso-facing";
import { WORLD_ISO_WALK_SPEED } from "./world-iso-gait";
import { WORLD_ISO_GREYBOX } from "./world-iso-greybox";
import { worldIsoProjection } from "./world-iso-projection";

export type WorldIsoCrowdJoin = Readonly<{
 id: string;
 kind: "pal" | "visitor";
 at: GroundPoint;
 facing?: WorldHdDirection;
}>;
export type WorldIsoCrowdPose = Readonly<{
 id: string;
 kind: "pal" | "visitor";
 at: GroundPoint;
 facing: WorldHdDirection;
 walking: boolean;
 waiting: boolean;
 walked: number;
}>;
type MutableActor = {
 id: string; kind: "pal" | "visitor"; at: GroundPoint; facing: WorldHdDirection;
 goal: GroundPoint; path: GroundPoint[]; waypoint: number; walking: boolean; waiting: boolean; walked: number;
};
const distance = (a: GroundPoint, b: GroundPoint) => Math.hypot(a.u - b.u, a.v - b.v);
const copy = (p: GroundPoint): GroundPoint => ({ u: p.u, v: p.v });
const EPS = 1e-8;
const MAX_ACTORS = 15;

/**
 * Pure ground-space actor reservations for the Step 1b nonmounted preview.
 * All furniture routes use the sealed Step 1a plan. Each tick checks the complete swept
 * segment against all actors' previous and newly reserved positions, never teleporting
 * through one another. Waiting is intentionally conservative; no false deadlock-freedom
 * or 25-second recovery guarantee is asserted until the Stage 4 crowd stress gate.
 */
export class WorldIsoCrowd {
 readonly plan: GroundPlan;
 readonly radius: number;
 private actors = new Map<string, MutableActor>();
 private projection = worldIsoProjection();

 constructor(plan: GroundPlan = WORLD_ISO_GREYBOX, radius = WORLD_ISO_FOOTPRINT) {
  if (!worldIsoPlanSealed(plan) || !worldIsoRadiusOk(radius)) throw new RangeError("Crowd requires a sealed ground plan and a supported footprint.");
  this.plan = plan;
  this.radius = radius;
 }

 join(input: WorldIsoCrowdJoin): boolean {
  if (!input.id || this.actors.has(input.id) || this.actors.size >= MAX_ACTORS || !worldIsoPointFree(this.plan, input.at, this.radius)) return false;
  if ([...this.actors.values()].some(a => distance(a.at, input.at) < 2 * this.radius - EPS)) return false;
  const at = copy(input.at);
  this.actors.set(input.id, { id: input.id, kind: input.kind, at, goal: copy(at), path: [copy(at)], waypoint: 1,
   facing: input.facing ?? "s", walking: false, waiting: false, walked: 0 });
  return true;
 }

 leave(id: string): void { this.actors.delete(id); }
 ids(): string[] { return [...this.actors.keys()].sort(); }

 /** Return false for unknown actors, blocked endpoints or unreachable static routes. */
 assign(id: string, target: GroundPoint): boolean {
  const a = this.actors.get(id);
  if (!a || !worldIsoPointFree(this.plan, target, this.radius)) return false;
  if (distance(target, a.goal) < EPS) return true;
  const path = worldIsoPath(this.plan, a.at, target, this.radius);
  if (!path) return false;
  a.goal = copy(target); a.path = path; a.waypoint = 1; a.waiting = false;
  return true;
 }

 pose(id: string): WorldIsoCrowdPose | null {
  const a = this.actors.get(id);
  return a ? { id: a.id, kind: a.kind, at: copy(a.at), facing: a.facing, walking: a.walking, waiting: a.waiting, walked: a.walked } : null;
 }
 snapshot(): WorldIsoCrowdPose[] { return this.ids().map(id => this.pose(id)!); }

 /**
  * Advance one bounded time slice. Existing actors' old positions remain reserved until
  * the next slice, even if they move this slice: this forbids position swaps and collisions.
  * Sorting puts permanent Pals ahead of visitors, with stable id tie-breaks.
  */
 step(dtMs: number, paused = false): void {
  if (!Number.isFinite(dtMs) || dtMs <= 0 || paused) {
   for (const a of this.actors.values()) { a.walking = false; a.waiting = false; }
   return;
  }
  const step = Math.min(100, dtMs) / 1000 * WORLD_ISO_WALK_SPEED;
  const ordered = [...this.actors.values()].sort((a, b) => Number(b.kind === "pal") - Number(a.kind === "pal") || a.id.localeCompare(b.id));
  const prior = new Map(ordered.map(a => [a.id, copy(a.at)]));
  for (const a of ordered) {
   a.walking = false; a.waiting = false;
   let left = step, candidate = copy(a.at), nextIndex = a.waypoint;
   while (left > EPS && nextIndex < a.path.length) {
    const next = a.path[nextIndex]!, remaining = distance(candidate, next);
    if (remaining <= EPS) { nextIndex++; continue; }
    const portion = Math.min(left, remaining) / remaining;
    candidate = { u: candidate.u + (next.u - candidate.u) * portion, v: candidate.v + (next.v - candidate.v) * portion };
    left -= Math.min(left, remaining);
    if (portion >= 1 - EPS) nextIndex++;
   }
   const traveled = distance(a.at, candidate);
   if (traveled <= EPS) { a.waypoint = nextIndex; continue; }
   // A single tick may traverse a tight turn; verify the actual swept movement chord.
   if (!worldIsoSegmentClear(this.plan, a.at, candidate, this.radius)) { a.waiting = true; continue; }
   const collision = ordered.some(b => {
    if (b.id === a.id) return false;
    const old = prior.get(b.id)!;
    // Check against both prior and updated movement segments.
    return worldIsoSegmentDistance(a.at, candidate, old, b.at) < 2 * this.radius - EPS;
   });
   if (collision) { a.waiting = true; continue; }
   a.facing = worldIsoGroundFacing(this.projection, a.at, candidate, a.facing);
   a.at = candidate; a.waypoint = nextIndex; a.walked += traveled; a.walking = true;
  }
 }

 /** Every actor is on valid ground and pairwise separated (for CI and runtime fail-safe checks). */
 valid(): boolean {
  const actors = [...this.actors.values()];
  return actors.every(a => worldIsoPointFree(this.plan, a.at, this.radius)) &&
   actors.every((a, i) => actors.slice(i + 1).every(b => distance(a.at, b.at) >= 2 * this.radius - EPS));
 }
}

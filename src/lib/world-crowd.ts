import type { CharacterMode } from "./hellraiser";
import type { Heading } from "./office-motion";
import { WORLD_GRID_STEP, WORLD_SCENE_ASPECT, worldHeadingOf, worldPath, worldPointIsWalkable, worldScreenDistance, worldSegmentClear, type WorldPoint } from "./world-floor";

/**
 * Living World crowd layer: keeps Pals and visitors from walking through each other.
 *
 * Every actor still follows its own deterministic route (world-wander / world-navigation); the route only
 * gives a *target* for each moment. The crowd moves the visible actor towards that target one capped,
 * walkable step at a time, so nothing ever jumps: straight when clear, otherwise keeping right and
 * steering around people, or walking an A* path around furniture. When someone is in the way the actor
 * stands and waits; the route clock pauses briefly (at most PAUSE_MAX) and is never paused while the
 * route itself is dwelling, so schedules keep running and nobody deadlocks. Afterwards the actor catches
 * up at up to CATCH_UP × its gait speed. Lower-priority actors also make way (sidestep or step back) for a
 * higher-priority actor walking into them or waiting on them. Fixed actors (office desk choreography,
 * Green Jacket's scripted route, paused characters) are walked around and never pushed.
 *
 * Coordinates are feet positions in percent of the scene (x of width, y of height). Bounded cost:
 * O(actors) per step plus an occasional cached A* (at most one per actor every PATH_RETRY_MS).
 */
export type WorldCrowdPlanPose = Readonly<{ x: number; y: number; walking: boolean; facing: Heading }>;
export type WorldCrowdPlan = (time: number) => WorldCrowdPlanPose;
export type WorldCrowdMember = Readonly<{
 id: string;
 /** Higher keeps right of way. Fixed obstacles always win. */
 priority: number;
 /** Feet footprint half-width (x %) and half-depth (y %). */
 rx: number; ry: number;
 /** Cruising speed in screen % per second (world-wander gait speed). */
 speed: number;
 /** Route as a pure function of route time. Absent: a fixed or externally placed obstacle. */
 plan?: WorldCrowdPlan;
}>;
export type WorldCrowdMode = "follow" | "catch-up" | "steer" | "wait" | "yield" | "fixed";
export type WorldCrowdPose = Readonly<{
 x: number; y: number; facing: Heading;
 /** The display moved this tick; drive footstep frames from `walked`. */
 walking: boolean;
 /** Standing because someone is in the way. */
 waiting: boolean;
 /** Route time reached. */
 time: number;
 /** Total screen distance walked by the display (distance-driven footsteps). */
 walked: number;
 /** Screen distance between the actor and its route point (0 = exactly on route). */
 lag: number;
 mode: WorldCrowdMode;
}>;

/** Footprints (screen-relative) — phones draw characters larger relative to the scene. */
/**
 * Feet footprints (half-width x %, half-depth y %). Depth is about half the width on the foreshortened floor,
 * so two people 2% apart in depth pass one in front of the other. Phones draw characters larger relative
 * to the scene, so their footprints are larger.
 */
export const WORLD_CROWD_FOOTPRINT = { desktop: { rx: 2.2, ry: 1 }, phone: { rx: 3.1, ry: 1.4 } } as const;
export const WORLD_CROWD_PRIORITY = { guest: 1000, visitor: 2000, pal: 3000, fixed: 1e9 } as const;
const MAX_DELTA = 250, SUB_STEP = 50;
const CATCH_UP = 1.25;
const PAUSE_MAX = 1500;
const LAG_MAX = 8;
const PUSH_FRESH = 450;
const STALE_MS = 1500;
const PATH_RETRY_MS = 1500;
const STEER_AROUND_AFTER = 600;
/** Jam handling: lower-ranked actors step aside to a free spot, then (last resort) brush past at reduced spacing. */
const CLEAR_AFTER = 2500, PARK_HOLD = 1600, PARK_COOLDOWN = 6000, PARK_GIVE_UP = 2500;
const SQUEEZE_AFTER = 10000, SQUEEZE = 0.6;
const STEER_ANGLES = [35, -35, 70, -70, 105, -105].map(a => a * Math.PI / 180);

type Route = { points: WorldPoint[]; index: number; goal: WorldPoint; at: number };
type State = {
 member: WorldCrowdMember;
 time: number; x: number; y: number; px: number; py: number;
 facing: Heading; walking: boolean; waiting: boolean; walked: number; mode: WorldCrowdMode;
 wait: number; seen: number; paused: boolean; lag: number;
 push?: { id: string; at: number };
 route?: Route;
 park?: { spot: WorldPoint; arrived?: number; stuck: number };
 parkAfter: number;
};
const round = (v: number) => Math.round(v * 1000) / 1000;
type Ranked = { member: WorldCrowdMember };
/** Right of way: higher priority, ties broken by id so two actors never wait on each other. */
const outranks = (a: Ranked, b: Ranked) => a.member.priority !== b.member.priority ? a.member.priority > b.member.priority : a.member.id > b.member.id;
const dist = (a: WorldPoint, b: WorldPoint) => worldScreenDistance(a, b);
/** Stable 0..999 tie-break so equal roles never argue forever. */
export function worldCrowdTieBreak(id: string): number {
 let h = 2166136261;
 for (let i = 0; i < id.length; i++) { h ^= id.charCodeAt(i); h = Math.imul(h, 16777619); }
 return (h >>> 0) % 1000;
}

export class WorldCrowd {
 private readonly actors = new Map<string, State>();
 constructor(readonly theme: CharacterMode) {}

 get size() { return this.actors.size; }
 has(id: string) { return this.actors.has(id); }
 ids() { return [...this.actors.keys()]; }

 /** Add an actor at its route position for `time`. Re-joining an existing actor keeps its current display. */
 join(member: WorldCrowdMember, time: number, now: number): WorldCrowdPose {
  const found = this.actors.get(member.id);
  if (found) { found.member = member; found.seen = now; found.paused = false; if (member.plan && found.mode === "fixed") found.mode = "follow"; return this.pose(member.id)!; }
  const start = member.plan ? member.plan(time) : { x: 50, y: 70, walking: false, facing: "s" as Heading };
  const state: State = { member, time, x: start.x, y: start.y, px: start.x, py: start.y, facing: start.facing, walking: false, waiting: false,
   walked: 0, mode: member.plan ? "follow" : "fixed", wait: 0, seen: now, paused: false, lag: 0, parkAfter: -Infinity };
  // Entering onto someone (nothing is drawn yet, so this is not a jump): appear at the nearest free spot and walk on.
  if (member.plan) {
   const others = [...this.actors.values()];
   if (others.some(o => this.ellipse(state, o, state.x, state.y) < 1)) {
    const free = this.freeSpot(state, others);
    if (free) { state.x = state.px = free.x; state.y = state.py = free.y; state.lag = dist(free, start); state.mode = "catch-up"; }
   }
  }
  this.actors.set(member.id, state);
  return this.pose(member.id)!;
 }
 leave(id: string) { this.actors.delete(id); for (const s of this.actors.values()) if (s.push?.id === id) delete s.push; }
 /** Externally driven actors (office desk choreography, Green Jacket): position only, always right of way. */
 place(member: WorldCrowdMember, x: number, y: number, now: number, facing: Heading = "s") {
  const { plan: _route, ...fixed } = member; void _route;
  let s = this.actors.get(member.id);
  if (!s) { this.join(fixed, 0, now); s = this.actors.get(member.id)!; s.x = s.px = x; s.y = s.py = y; }
  s.member = { ...fixed, priority: WORLD_CROWD_PRIORITY.fixed };
  s.px = s.x; s.py = s.y; s.x = x; s.y = y; s.facing = facing; s.seen = now; s.mode = "fixed";
 }
 /** Paused (Focus Mode, reduced motion, low power) actors stand still and are walked around, never pushed. */
 setPaused(id: string, paused: boolean, now: number) { const s = this.actors.get(id); if (s) { s.paused = paused; s.seen = now; if (paused) { s.walking = false; s.px = s.x; s.py = s.y; } } }
 pose(id: string): WorldCrowdPose | null {
  const s = this.actors.get(id);
  return s ? { x: s.x, y: s.y, facing: s.facing, walking: s.walking, waiting: s.waiting, time: s.time, walked: s.walked, lag: round(s.lag), mode: s.mode } : null;
 }
 /** Footprint overlap value between two actors (< 1 means their feet footprints overlap). */
 spacing(a: string, b: string): number {
  const s = this.actors.get(a), o = this.actors.get(b);
  return s && o ? this.ellipse(s, o, s.x, s.y) : Infinity;
 }

 /** Advance one actor by `delta` ms (clamped to MAX_DELTA so a long gap never becomes a jump). */
 advance(id: string, delta: number, now: number): WorldCrowdPose | null {
  const s = this.actors.get(id);
  if (!s || !s.member.plan) return this.pose(id);
  s.seen = now; s.paused = false;
  let left = Math.max(0, Math.min(MAX_DELTA, Number.isFinite(delta) ? delta : 0));
  const startX = s.x, startY = s.y, walkedBefore = s.walked;
  s.px = s.x; s.py = s.y;
  while (left > 0) { const dt = Math.min(SUB_STEP, left); this.tick(s, dt, now); left -= dt; }
  s.walking = s.walked - walkedBefore > 1e-4;
  if (s.walking) s.facing = worldHeadingOf(s.x - startX, s.y - startY);
  s.px = startX; s.py = startY;
  return this.pose(id);
 }

 private fixed(o: State, now: number) { return !o.member.plan || o.paused || now - o.seen > STALE_MS; }
 private ellipse(s: State, o: State, x: number, y: number, k = 1) {
  const ax = (s.member.rx + o.member.rx) * k, ay = (s.member.ry + o.member.ry) * k;
  return ((x - o.x) / ax) ** 2 + ((y - o.y) / ay) ** 2;
 }
 /** The closest actor `s` would move into at (x, y): footprints overlap and are not moving apart. */
 private blocker(s: State, x: number, y: number): State | null {
  let best: State | null = null, bestE = Infinity;
  const k = s.wait > SQUEEZE_AFTER ? SQUEEZE : 1;
  for (const o of this.actors.values()) {
   if (o === s) continue;
   const e = this.ellipse(s, o, x, y, k);
   if (e < 1 && e <= this.ellipse(s, o, s.x, s.y, k) + 1e-9 && e < bestE) { best = o; bestE = e; }
  }
  return best;
 }
 private walkable(from: WorldPoint, to: WorldPoint) {
  if (!worldPointIsWalkable(to, this.theme)) return false;
  if (Math.abs(to.x - from.x) + Math.abs(to.y - from.y) < 1e-9) return true;
  // Off the floor (should not happen): any step back onto it is allowed.
  return !worldPointIsWalkable(from, this.theme) || worldSegmentClear(from, to, this.theme);
 }
 private moveTo(s: State, x: number, y: number) { s.walked += dist({ x: s.x, y: s.y }, { x, y }); s.x = x; s.y = y; }
 /** Higher-priority neighbour stepping into s, or waiting on s → s must make way. */
 private pusher(s: State, now: number): State | null {
  let best: State | null = null;
  for (const o of this.actors.values()) {
   if (o === s || !outranks(o, s)) continue;
   const pushed = s.push?.id === o.member.id && now - s.push.at < PUSH_FRESH && this.ellipse(s, o, s.x, s.y, 1.6) < 1;
   const approaching = this.ellipse(s, o, s.x, s.y, 1.25) < 1 &&
    this.ellipse(s, o, s.x, s.y) < this.ellipse(s, o, s.x - (o.x - o.px), s.y - (o.y - o.py)) - 1e-6;
   // Already overlapping (just joined, re-entered, or a moving obstacle reached us): step out of its way.
   const overlapping = this.ellipse(s, o, s.x, s.y) < 1;
   if ((pushed || approaching || overlapping) && (!best || outranks(o, best))) best = o;
  }
  return best;
 }

 private overlapStuck(s: State): State | null {
  for (const o of this.actors.values()) if (o !== s && o.wait > 1000 && this.ellipse(s, o, s.x, s.y) < 1) return o;
  return null;
 }
 private tick(s: State, dt: number, now: number) {
  const plan = s.member.plan!, step = s.member.speed * dt / 1000;
  if (s.park && this.parkStep(s, dt, step, now)) { s.time += dt; s.lag = dist(s, plan(s.time)); return; }
  const pusher = this.pusher(s, now);
  if (pusher) {
   if (this.yieldTo(s, pusher, step)) { s.time += dt; s.lag = dist(s, plan(s.time)); return; }
   // Cornered: walk to a nearby free spot instead of holding up a higher-priority actor.
   if (now >= s.parkAfter && this.findPark(s, now)) { s.time += dt; s.lag = dist(s, plan(s.time)); return; }
  }
  // Overlapping someone who cannot get out of the way: whoever can step apart does.
  const stuckWith = this.overlapStuck(s);
  if (stuckWith && this.yieldTo(s, stuckWith, step)) { s.time += dt; s.lag = dist(s, plan(s.time)); return; }
  const nextTime = s.time + dt, target = plan(nextTime), here = { x: s.x, y: s.y };
  const gap = dist(here, target);
  const moved = this.approach(s, target, Math.min(gap, step * (gap > step * 1.05 ? CATCH_UP : 1)), step, now);
  if (moved === true) {
   s.wait = 0; s.waiting = false;
   const lag = dist(s, target);
   // Keep the schedule running unless we have fallen far behind a walking route (then catch up first).
   if (lag <= LAG_MAX || !target.walking) s.time = nextTime;
   s.lag = dist(s, plan(s.time));
   s.mode = s.lag < 0.3 ? "follow" : s.mode === "steer" ? "steer" : "catch-up";
   return;
  }
  // Someone (or something) is in the way: stand and wait.
  s.wait += dt; s.waiting = true; s.mode = "wait";
  if (moved && outranks(s, moved) && !this.fixed(moved, now)) moved.push = { id: s.member.id, at: now };
  // A jam (the actor in our way is itself stuck): the lower-ranked one clears the way.
  if (moved && s.wait > CLEAR_AFTER && now >= s.parkAfter && (moved.waiting || this.fixed(moved, now)) && !outranks(s, moved)) this.findPark(s, now);
  if (moved) s.facing = worldHeadingOf(moved.x - s.x, moved.y - s.y);
  // Brief pause only: a dwelling route keeps its schedule, a walking one resumes after PAUSE_MAX.
  if (!target.walking || s.wait > PAUSE_MAX) s.time = nextTime;
  s.lag = dist(s, plan(s.time));
 }

 /**
  * One step (≤ `stride`) towards `target`. Returns true when moved, otherwise the actor in the way
  * (or null when only furniture blocks and no path step was possible).
  */
 private approach(s: State, target: WorldPoint, stride: number, step: number, now: number): true | State | null {
  const here = { x: s.x, y: s.y }, gap = dist(here, target);
  if (gap < 1e-6) return true;
  const ux = (target.x - here.x) / gap, uy = (target.y - here.y) / gap;
  const at = (dx: number, dy: number, len: number) => ({ x: here.x + dx * len, y: here.y + dy * len });
  // Distances are screen units; convert a screen-direction step back to floor % (y scaled by the aspect).
  const toFloor = (p: { x: number; y: number }) => ({ x: p.x, y: here.y + (p.y - here.y) / ASPECT });
  const direct = toFloor(at(ux, uy * ASPECT, stride));
  const clearPath = this.walkable(here, target) || this.walkable(here, direct);
  if (clearPath) {
   const end = stride >= gap - 1e-9 ? target : direct;
   if (this.walkable(here, end)) {
    const block = this.blocker(s, end.x, end.y);
    if (!block) { this.moveTo(s, end.x, end.y); delete s.route; return true; }
    // Someone is standing on our route point itself: wait beside them rather than circling.
    if (this.ellipse(s, block, target.x, target.y) < 1) return block;
    // Keep right, then left, at growing angles; never move into anyone.
    const sx = ux, sy = uy * ASPECT;
    for (const angle of STEER_ANGLES) {
     const c = Math.cos(angle), n = Math.sin(angle), dx = sx * c - sy * n, dy = sx * n + sy * c, len = Math.hypot(dx, dy) || 1;
     const to = toFloor(at(dx / len, dy / len, step));
     if (!this.walkable(here, to) || this.blocker(s, to.x, to.y)) continue;
     if (Math.abs(angle) < 1.5 && dist(to, target) >= gap) continue;
     if (dist(to, block) <= dist(here, block) && Math.abs(angle) >= 1.5) continue;
     this.moveTo(s, to.x, to.y); s.mode = "steer"; return true;
    }
    // Boxed in on the straight line: after a short wait, look for a way round the standing people.
    if (s.wait < STEER_AROUND_AFTER) return block;
    const around = this.pathStep(s, target, stride, now);
    return around === null ? block : around;
   }
  }
  // Furniture between us and the route point: walk an A* path (people-aware), cached.
  return this.pathStep(s, target, stride, now);
 }
 private pathStep(s: State, target: WorldPoint, stride: number, now: number): true | State | null {
  const here = { x: s.x, y: s.y };
  const route = this.routeTo(s, target, now);
  if (!route) return null;
  let waypoint = route.points[route.index]!;
  while (dist(here, waypoint) < 1e-3 && route.index < route.points.length - 1) waypoint = route.points[++route.index]!;
  const d = dist(here, waypoint), len = Math.min(stride, d);
  // A path that cannot take us anywhere is not progress.
  if (d < 1e-9) { delete s.route; return null; }
  const to = { x: here.x + (waypoint.x - here.x) * len / d, y: here.y + (waypoint.y - here.y) * len / d };
  if (!this.walkable(here, to)) { delete s.route; return null; }
  const block = this.blocker(s, to.x, to.y);
  if (block) return block;
  this.moveTo(s, to.x, to.y);
  if (len >= d - 1e-9 && route.index < route.points.length - 1) route.index++;
  return true;
 }
 private routeTo(s: State, target: WorldPoint, now: number): Route | null {
  const r = s.route;
  if (r && dist(r.goal, target) < WORLD_GRID_STEP && r.index < r.points.length) return r;
  if (r && now - r.at < PATH_RETRY_MS && r.index < r.points.length) return r;
  const others = [...this.actors.values()].filter(o => o !== s && (this.fixed(o, now) || !o.walking));
  const here = { x: s.x, y: s.y };
  const path = worldPath(here, target, this.theme, p => dist(p, here) > WORLD_GRID_STEP && others.some(o => this.ellipse(s, o, p.x, p.y, 0.9) < 1));
  if (path.length < 1) { delete s.route; return null; }
  const points = [...path.slice(path.length > 1 ? 1 : 0)];
  if (worldPointIsWalkable(target, this.theme) && worldSegmentClear(points[points.length - 1]!, target, this.theme)) points.push({ x: target.x, y: target.y });
  s.route = { points, index: 0, goal: { x: target.x, y: target.y }, at: now };
  return s.route;
 }

 /** Nearest free, reachable spot (no one within 1.6× spacing) in rings around the actor. */
 private freeSpot(s: State, others: State[]): WorldPoint | null {
  const here = { x: s.x, y: s.y };
  // Comfortable room first; in a full corner accept any spot that does not overlap anyone.
  for (const k of [1.6, 1.05]) for (let r = 1.5; r <= 18; r += 1.5) for (let i = 0; i < 16; i++) {
   const a = (i + (worldCrowdTieBreak(s.member.id) % 16) / 16) * Math.PI / 8;
   const spot = { x: here.x + Math.cos(a) * r, y: here.y + Math.sin(a) * r / ASPECT };
   if (!worldPointIsWalkable(spot, this.theme) || others.some(o => this.ellipse(s, o, spot.x, spot.y, k) < 1)) continue;
   if (this.reachable(s, here, spot, others)) return spot;
  }
  return null;
 }
 private findPark(s: State, now: number): boolean {
  const spot = this.freeSpot(s, [...this.actors.values()].filter(o => o !== s));
  if (!spot) { s.parkAfter = now + PARK_COOLDOWN / 2; return false; }
  s.park = { spot, stuck: 0 }; s.parkAfter = now + PARK_COOLDOWN; delete s.route;
  return true;
 }
 /** A straight clear walk, or an A* path whose last cell has a clear final step onto `spot`. */
 private reachable(s: State, here: WorldPoint, spot: WorldPoint, others: State[]): boolean {
  if (worldSegmentClear(here, spot, this.theme)) return true;
  const path = worldPath(here, spot, this.theme, p => dist(p, here) > WORLD_GRID_STEP && others.some(o => this.ellipse(s, o, p.x, p.y, 0.9) < 1));
  const last = path[path.length - 1];
  return path.length > 1 && !!last && worldSegmentClear(last, spot, this.theme);
 }
 private parkStep(s: State, dt: number, step: number, now: number): boolean {
  const park = s.park!;
  if (park.arrived !== undefined) {
   if (now - park.arrived >= PARK_HOLD) { delete s.park; s.wait = 0; return false; }
   s.mode = "yield"; s.waiting = false; return true;
  }
  const result = dist(s, park.spot) < 1e-3 ? true : this.pathStep(s, park.spot, step, now);
  if (result === true) {
   park.stuck = 0; s.mode = "yield"; s.waiting = false;
   if (dist(s, park.spot) < 1e-3) park.arrived = now;
   return true;
  }
  park.stuck += dt;
  if (park.stuck >= PARK_GIVE_UP) { delete s.park; return false; }
  s.mode = "wait"; s.waiting = true; return true;
 }

 /** Make room for `o`: sidestep off its line (keeping right of its path) or step straight away. */
 private yieldTo(s: State, o: State, step: number): boolean {
  let ax = s.x - o.x, ay = (s.y - o.y) * ASPECT;
  if (Math.hypot(ax, ay) < 1e-6) { const a = worldCrowdTieBreak(s.member.id) / 1000 * Math.PI * 2; ax = Math.cos(a); ay = Math.sin(a); }
  const len = Math.hypot(ax, ay), ux = ax / len, uy = ay / len;
  const vx = o.x - o.px, vy = (o.y - o.py) * ASPECT, moving = Math.hypot(vx, vy) > 1e-6;
  let rx = moving ? -vy : -uy, ry = moving ? vx : ux; const rl = Math.hypot(rx, ry) || 1; rx /= rl; ry /= rl;
  // Side of the other actor's path we are already on, so we never cross in front of it.
  const side = rx * ux + ry * uy >= 0 ? 1 : -1;
  const options: Array<[number, number]> = [[rx * side, ry * side], [ux, uy], [(rx * side + ux) / Math.SQRT2, (ry * side + uy) / Math.SQRT2], [-rx * side, -ry * side]];
  let best: { x: number; y: number; e: number } | null = null;
  for (const [dx, dy] of options) {
   const to = { x: s.x + dx * step, y: s.y + dy * step / ASPECT };
   if (!this.walkable({ x: s.x, y: s.y }, to)) continue;
   const other = this.blocker(s, to.x, to.y);
   if (other && other !== o) continue;
   const e = this.ellipse(s, o, to.x, to.y);
   if (e > this.ellipse(s, o, s.x, s.y) + 1e-9 && (!best || e > best.e + 0.02)) best = { x: to.x, y: to.y, e };
  }
  if (!best) return false;
  this.moveTo(s, best.x, best.y); s.mode = "yield"; s.waiting = false;
  return true;
 }
}
const ASPECT = WORLD_SCENE_ASPECT;

const crowds = new Map<CharacterMode, WorldCrowd>();
/** One crowd per room theme, shared by every actor component in that room. */
export function worldCrowd(theme: CharacterMode): WorldCrowd {
 let crowd = crowds.get(theme);
 if (!crowd) { crowd = new WorldCrowd(theme); crowds.set(theme, crowd); }
 return crowd;
}
/** Footprint for a body scale (1 = adult) on this device class. */
export function worldCrowdFootprint(scale = 1, phone = false) {
 const f = phone ? WORLD_CROWD_FOOTPRINT.phone : WORLD_CROWD_FOOTPRINT.desktop;
 const s = Number.isFinite(scale) && scale > 0 ? Math.max(0.4, Math.min(1.8, scale)) : 1;
 return { rx: f.rx * s, ry: f.ry * Math.sqrt(s) };
}
export const worldCrowdPhone = () => typeof window !== "undefined" && typeof window.matchMedia === "function" && window.matchMedia("(max-width: 700px)").matches;

/** Route pose fields the room components read (world-wander and world-navigation share these). */
type RouteView = { x: number; y: number; walking: boolean; travelled?: number; dwelling?: boolean; fixture?: string };
/**
 * Merge a crowd position into a route pose: the actor is drawn where the crowd put it, walks when it
 * actually moved (footsteps from distance walked), looks around while waiting or off its spot, and only
 * uses furniture or a dwell action when it is really standing on its route point.
 */
export function worldCrowdView<T extends RouteView & { action: string }>(route: T, crowd: WorldCrowdPose | null, facingKey: "facing" | "heading"): T {
 if (!crowd) return route;
 const onRoute = crowd.lag < 1;
 const action = crowd.walking ? "walk" : crowd.waiting || !onRoute ? "look" : route.action === "walk" ? "idle" : route.action;
 const facing = crowd.walking || crowd.waiting ? crowd.facing : (route as unknown as Record<string, Heading>)[facingKey]!;
 const view = { ...route, x: crowd.x, y: crowd.y, walking: crowd.walking, action, [facingKey]: facing, travelled: crowd.walked,
  ...("dwelling" in route ? { dwelling: !crowd.walking && onRoute && !!route.dwelling } : {}) } as T;
 if (!onRoute || action !== route.action) delete (view as { fixture?: string }).fixture;
 return view;
}

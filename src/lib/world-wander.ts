import type { CharacterMode } from "./hellraiser";
import type { Heading } from "./office-motion";
import {
 worldHeadingOf, worldPath, worldRoomPlan, worldScreenDistance, worldSmoothPath, worldSnap,
 type WorldPoint,
} from "./world-floor";

/**
 * Deterministic, browser-only wandering for Living World characters (cosmetic only: no AI, network or storage).
 * A plan is a looping itinerary of stops on the calibrated floor: walk at a steady gait with a short
 * ease in/out, arrive, turn in place, then idle, look around, wave, rest or use a piece of furniture.
 * The same elapsed time always gives the same pose, so pausing and resuming never teleports.
 */
export const WORLD_GAITS = {
 humanoid: { speed: 5, ramp: 320, stride: 2.4 },
 quadruped: { speed: 6.5, ramp: 260, stride: 2.8 },
 flying: { speed: 7, ramp: 520, stride: 5 },
 floating: { speed: 3.6, ramp: 700, stride: 5 },
 rolling: { speed: 6, ramp: 420, stride: 3.2 },
} as const;
export type WorldGait = keyof typeof WORLD_GAITS;
export const worldGaitOf = (movement: unknown): WorldGait =>
 typeof movement === "string" && movement in WORLD_GAITS ? movement as WorldGait : "humanoid";

export type WorldStopActivity = "idle" | "look" | "wave" | "interaction" | "rest" | "celebrate";
export type WorldWanderAction = "walk" | "turn" | WorldStopActivity;
type Stop = Readonly<{ point: WorldPoint; activity: WorldStopActivity; facing?: Heading; fixture?: string }>;
type DwellSegment = Readonly<{ kind: "dwell"; start: number; end: number; stop: Stop; arrive: Heading }>;
type WalkSegment = Readonly<{ kind: "walk"; start: number; end: number; path: readonly WorldPoint[]; lengths: readonly number[]; distance: number; ramp: number }>;
type Segment = DwellSegment | WalkSegment;
export type WorldWanderPlan = Readonly<{ period: number; gait: WorldGait; start: WorldPoint; segments: readonly Segment[] }>;
export type WorldWanderPose = Readonly<{
 x: number; y: number; facing: Heading; action: WorldWanderAction; walking: boolean;
 /** Screen distance walked in the current leg: drive footstep frames from this to avoid foot sliding. */
 travelled: number;
 /** Furniture being used, when the action is "interaction". */
 fixture?: string;
 dwelling: boolean;
}>;
export type WorldWanderOptions = Readonly<{
 theme: CharacterMode; seed: string; start: WorldPoint; gait?: WorldGait;
 /** Number of stops including the return home. */
 legs?: number;
 /** Exact loop length in ms; dwell times stretch or shrink to fit (walking speed never changes). */
 period?: number;
 /** Prefer stops within this screen distance of the start, so characters keep a neighbourhood. */
 roam?: number;
}>;

const COMPASS: Heading[] = ["n", "ne", "e", "se", "s", "sw", "w", "nw"];
const turnSteps = (from: Heading, to: Heading) => {
 const delta = ((COMPASS.indexOf(to) - COMPASS.indexOf(from)) % 8 + 8) % 8;
 return delta > 4 ? delta - 8 : delta;
};
const rotate = (from: Heading, steps: number): Heading => COMPASS[((COMPASS.indexOf(from) + steps) % 8 + 8) % 8]!;
/** Turning in place: one 45° step every `stepMs`, the short way round. */
export function worldTurnToward(from: Heading, to: Heading, elapsed: number, stepMs = 110): { facing: Heading; turning: boolean } {
 const steps = turnSteps(from, to), done = Math.floor(Math.max(0, elapsed) / stepMs);
 if (done >= Math.abs(steps)) return { facing: to, turning: false };
 return { facing: rotate(from, Math.sign(steps) * done), turning: true };
}

function hash(text: string): number {
 let h = 2166136261;
 for (let i = 0; i < text.length; i++) { h ^= text.charCodeAt(i); h = Math.imul(h, 16777619); }
 return h >>> 0;
}
function random(seed: string) {
 let a = hash(seed) || 1;
 return () => {
  a = (a + 0x6d2b79f5) | 0;
  let t = Math.imul(a ^ (a >>> 15), 1 | a);
  t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
  return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
 };
}
const between = (rand: () => number, low: number, high: number) => Math.round(low + (high - low) * rand());
function pick<T>(rand: () => number, items: readonly { item: T; weight: number }[]): T | undefined {
 const total = items.reduce((sum, entry) => sum + Math.max(0, entry.weight), 0);
 let roll = rand() * total;
 for (const entry of items) { roll -= Math.max(0, entry.weight); if (roll <= 0) return entry.item; }
 return items[items.length - 1]?.item;
}
const key = (point: WorldPoint) => point.x + "," + point.y;

type Candidate = Readonly<{ point: WorldPoint; fixture?: { id: string; facing: Heading } }>;
function candidates(theme: CharacterMode): Candidate[] {
 const plan = worldRoomPlan(theme), seen = new Set<string>(), out: Candidate[] = [];
 const add = (target: WorldPoint, fixture?: Candidate["fixture"]) => {
  const point = worldSnap(target, theme);
  if (!point) return;
  const id = key(point) + (fixture ? ":" + fixture.id : "");
  if (seen.has(id)) return;
  seen.add(id); out.push(fixture ? { point, fixture } : { point });
 };
 for (const fixture of plan.fixtures) add(fixture.stand, { id: fixture.id, facing: fixture.facing });
 for (const point of [...plan.visits, ...plan.homes]) add(point);
 return out;
}

type Leg = { path: WorldPoint[]; lengths: number[]; distance: number; walkMs: number; ramp: number; stop: Stop; arrive: Heading; dwell: number };
function legBetween(from: WorldPoint, to: WorldPoint, theme: CharacterMode, gait: WorldGait) {
 const raw = worldPath(from, to, theme);
 if (raw.length < 2) return null;
 const path = worldSmoothPath(raw, theme);
 const lengths = path.slice(1).map((point, index) => worldScreenDistance(path[index]!, point));
 const distance = lengths.reduce((sum, length) => sum + length, 0);
 if (distance <= 0) return null;
 const { speed, ramp } = WORLD_GAITS[gait];
 const cruise = distance / speed * 1000, easing = Math.min(ramp, cruise);
 const last = path[path.length - 1]!, before = path[path.length - 2]!;
 return { path, lengths, distance, walkMs: Math.round(cruise + easing), ramp: easing, arrive: worldHeadingOf(last.x - before.x, last.y - before.y) };
}
function dwellFor(activity: WorldStopActivity, rand: () => number) {
 switch (activity) {
  case "look": return between(rand, 3700, 5200);
  case "wave": return between(rand, 2000, 2700);
  case "celebrate": return between(rand, 1900, 2400);
  case "rest": return between(rand, 5200, 8200);
  case "interaction": return between(rand, 4600, 7200);
  default: return between(rand, 3000, 5400);
 }
}

const plans = new Map<string, WorldWanderPlan>();
/** Build (and cache) a looping itinerary. Unreachable stops are skipped; an isolated start just idles. */
export function worldWanderPlan(options: WorldWanderOptions): WorldWanderPlan {
 const gait = options.gait ?? "humanoid", legs = Math.max(1, Math.min(12, Math.floor(options.legs ?? 6)));
 const cacheKey = [options.theme, options.seed, options.start.x, options.start.y, gait, legs, options.period ?? 0, options.roam ?? 0].join("|");
 const cached = plans.get(cacheKey);
 if (cached) return cached;
 const theme = options.theme, start = worldSnap(options.start, theme) ?? options.start;
 const rand = random(cacheKey);
 // Only stops in the start's own floor region (some backdrops have furniture-separated corners).
 const pool = candidates(theme).filter(candidate => key(candidate.point) !== key(start) && worldPath(start, candidate.point, theme).length > 1);
 const chosen: Leg[] = [];
 let current = start;
 const recent: string[] = [key(start)];
 const initialDwell = between(rand, 1800, 3600);
 for (let index = 0; index < legs - 1; index++) {
  const options2 = pool.filter(candidate => !recent.slice(-3).includes(key(candidate.point)));
  const weighted = options2.map(candidate => {
   const distance = worldScreenDistance(current, candidate.point), home = worldScreenDistance(start, candidate.point);
   let weight = distance < 5 ? 0.15 : distance > 48 ? 0.35 : 1;
   if (options.roam && home > options.roam) weight *= 0.12;
   if (candidate.fixture) weight *= 1.5;
   return { item: candidate, weight };
  });
  // Try a few weighted choices before giving up on an unreachable region (e.g. a cut-off corner).
  let leg: Leg | null = null;
  for (let attempt = 0; attempt < 10 && !leg && weighted.length; attempt++) {
   const candidate = pick(rand, weighted);
   if (!candidate) break;
   const walk = legBetween(current, candidate.point, theme, gait);
   const entry = weighted.find(item => item.item === candidate);
   // Skip unreachable spots and long detours around furniture; pick something nearer instead.
   if (!walk || walk.distance > worldScreenDistance(current, candidate.point) * 1.9 + 10) { if (entry) entry.weight = 0; continue; }
   const activity: WorldStopActivity = candidate.fixture ? "interaction" :
    pick(rand, [{ item: "idle", weight: 3 }, { item: "look", weight: 3 }, { item: "wave", weight: 1 }, { item: "rest", weight: 0.8 }, { item: "celebrate", weight: 0.35 }]) ?? "idle";
   const stop: Stop = candidate.fixture ? { point: walk.path[walk.path.length - 1]!, activity, facing: candidate.fixture.facing, fixture: candidate.fixture.id } : { point: walk.path[walk.path.length - 1]!, activity };
   leg = { ...walk, stop, dwell: dwellFor(activity, rand) };
  }
  if (!leg) break;
  chosen.push(leg);
  current = leg.stop.point;
  recent.push(key(current));
 }
 const home = chosen.length ? legBetween(current, start, theme, gait) : null;
 let walks = [...chosen];
 if (home) walks.push({ ...home, stop: { point: start, activity: "idle" }, dwell: 0 });
 else walks = [];
 // Fit an exact loop length by dropping stops, then scaling the pauses.
 const minimum = 1200;
 if (options.period) {
  while (walks.length > 1 && walks.reduce((sum, leg) => sum + leg.walkMs, 0) + minimum * walks.length > options.period) {
   walks = walks.slice(0, -2);
   const tail = walks[walks.length - 1]?.stop.point ?? start;
   const back = walks.length ? legBetween(tail, start, theme, gait) : null;
   if (back) walks.push({ ...back, stop: { point: start, activity: "idle" }, dwell: 0 });
   else walks = [];
  }
  if (walks.length && walks.reduce((sum, leg) => sum + leg.walkMs, 0) + minimum * walks.length > options.period) walks = [];
 }
 const pauses = [initialDwell, ...walks.slice(0, -1).map(leg => leg.dwell)];
 if (options.period) {
  const walking = walks.reduce((sum, leg) => sum + leg.walkMs, 0), available = options.period - walking;
  const flexible = pauses.reduce((sum, pause) => sum + (pause - minimum), 0), spare = available - minimum * pauses.length;
  for (let i = 0; i < pauses.length; i++) pauses[i] = minimum + (flexible > 0 ? (pauses[i]! - minimum) / flexible * spare : spare / pauses.length);
 }
 const segments: Segment[] = [];
 let time = 0;
 const finalHeading = walks.length ? walks[walks.length - 1]!.arrive : "s";
 const startStop: Stop = { point: start, activity: "idle" };
 segments.push({ kind: "dwell", start: 0, end: pauses[0]!, stop: startStop, arrive: finalHeading });
 time = pauses[0]!;
 walks.forEach((leg, index) => {
  segments.push({ kind: "walk", start: time, end: time + leg.walkMs, path: leg.path, lengths: leg.lengths, distance: leg.distance, ramp: leg.ramp });
  time += leg.walkMs;
  if (index < walks.length - 1) {
   segments.push({ kind: "dwell", start: time, end: time + pauses[index + 1]!, stop: leg.stop, arrive: leg.arrive });
   time += pauses[index + 1]!;
  }
 });
 const period = options.period && walks.length ? options.period : Math.max(1, time);
 if (!walks.length) segments[0] = { ...segments[0]!, end: period } as DwellSegment;
 const plan: WorldWanderPlan = { period, gait, start, segments };
 if (plans.size > 400) plans.clear();
 plans.set(cacheKey, plan);
 return plan;
}

/** Distance covered after `t` ms of a walk with a linear ease in and out of `ramp` ms. */
function covered(segment: WalkSegment, t: number) {
 const total = segment.end - segment.start, speed = segment.distance / Math.max(1, total - segment.ramp), ramp = segment.ramp;
 if (ramp <= 0) return Math.min(segment.distance, speed * t);
 if (t < ramp) return speed * t * t / (2 * ramp);
 if (t > total - ramp) return Math.max(0, segment.distance - speed * (total - t) ** 2 / (2 * ramp));
 return speed * (t - ramp / 2);
}
function dwellFacing(segment: DwellSegment, t: number): { facing: Heading; action: WorldWanderAction } {
 const { stop, arrive } = segment;
 const settle = 650;
 const desired: Heading = stop.facing ?? (stop.activity === "wave" || stop.activity === "celebrate" || stop.activity === "rest" ? "s" :
  arrive === "n" || arrive === "ne" || arrive === "nw" ? "s" : arrive);
 if (stop.activity === "look") {
  const glance = Math.floor(Math.max(0, t - settle) / 1100) % 4;
  const target = t < settle ? arrive : glance === 1 ? rotate(arrive, -1) : glance === 3 ? rotate(arrive, 1) : arrive;
  return { facing: target, action: t < settle ? "idle" : "look" };
 }
 const turn = worldTurnToward(arrive, desired, t);
 return { facing: turn.facing, action: turn.turning ? "turn" : stop.activity };
}
/** Pose at any time; loops forever. */
export function worldWanderPose(plan: WorldWanderPlan, elapsed: number): WorldWanderPose {
 const time = ((Number.isFinite(elapsed) ? elapsed : 0) % plan.period + plan.period) % plan.period;
 let low = 0, high = plan.segments.length - 1;
 while (low < high) {
  const mid = (low + high + 1) >> 1;
  if (plan.segments[mid]!.start <= time) low = mid; else high = mid - 1;
 }
 const segment = plan.segments[low]!, t = time - segment.start;
 if (segment.kind === "dwell") {
  const look = dwellFacing(segment, t);
  return { x: segment.stop.point.x, y: segment.stop.point.y, facing: look.facing, action: look.action, walking: false, travelled: 0, dwelling: true,
   ...(segment.stop.fixture && look.action === "interaction" ? { fixture: segment.stop.fixture } : {}) };
 }
 const travelled = covered(segment, t);
 let left = travelled;
 for (let i = 0; i < segment.lengths.length; i++) {
  const length = segment.lengths[i]!, a = segment.path[i]!, b = segment.path[i + 1]!;
  if (left <= length || i === segment.lengths.length - 1) {
   const ratio = length ? Math.max(0, Math.min(1, left / length)) : 1;
   return { x: a.x + (b.x - a.x) * ratio, y: a.y + (b.y - a.y) * ratio, facing: worldHeadingOf(b.x - a.x, b.y - a.y), action: "walk", walking: true, travelled, dwelling: false };
  }
  left -= length;
 }
 const end = segment.path[segment.path.length - 1]!;
 return { x: end.x, y: end.y, facing: "s", action: "walk", walking: true, travelled, dwelling: false };
}
/** Footstep frame from distance, so feet stay planted while easing in and out. */
export const worldStepFrame = (pose: Pick<WorldWanderPose, "walking" | "travelled">, gait: WorldGait, frames = 4) =>
 pose.walking ? Math.floor(pose.travelled / (WORLD_GAITS[gait].stride / 2)) % Math.max(1, frames) : 0;

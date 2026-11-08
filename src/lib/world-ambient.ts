import type { CharacterMode } from "./hellraiser";
import type { Heading } from "./office-motion";
import type { PalMotion } from "./pal-motion";
import { worldHeadingOf, worldPath, worldScreenDistance, worldSmoothPath, type WorldPoint } from "./world-floor";

/**
 * Ambient life for the Living Universe HD world: calm, coordinated, deterministic schedules.
 *
 * Characters spend most of their time *somewhere* (their own desk, the sofa, the kitchenette, the window,
 * the whiteboard, the shelf, a conversation) and walk only between those stays. Spots are reserved over
 * time so two characters never aim for the same seat; Pals keep returning to their own desk; conversations
 * are scheduled for two characters at facing spots; night hours bring longer rests.
 *
 * Honesty rule: everything here is *ambient presentation*. Nothing in this module may be described as
 * real AI work. Real activity ("responding", "focus session") comes only from the app's authoritative
 * agent state and is applied by the room component on top of the schedule.
 */
export type AmbientActivity = "desk" | "relax" | "coffee" | "window" | "board" | "shelf" | "rest" | "stretch" | "chat" | "plant";
export type AmbientSpot = Readonly<{ id: string; kind: string; point: WorldPoint; facing: Heading; desk?: number }>;
export type AmbientActor = Readonly<{ id: string; name: string; kind: "pal" | "visitor"; home: string; speed: number }>;
type Walk = { kind: "walk"; start: number; end: number; path: WorldPoint[]; lengths: number[]; total: number };
type Stay = { kind: "stay"; start: number; end: number; spot: AmbientSpot; activity: AmbientActivity; partner?: string; partnerName?: string; facing: Heading };
export type AmbientSegment = Walk | Stay;
export type AmbientPlan = Readonly<{ id: string; period: number; segments: readonly AmbientSegment[] }>;
export type AmbientPose = Readonly<{
 x: number; y: number; facing: Heading; walking: boolean; activity: AmbientActivity | "walk";
 motion: PalMotion; spot?: string; partner?: string; partnerName?: string;
}>;

/** Period of one full ambient loop (the room continues where it was when reopened). */
export const AMBIENT_PERIOD = 20 * 60_000;
const DURATION: Record<AmbientActivity, [number, number]> = {
 desk: [70_000, 160_000], relax: [45_000, 100_000], coffee: [25_000, 50_000], window: [20_000, 40_000], board: [20_000, 45_000],
 shelf: [20_000, 40_000], rest: [80_000, 150_000], stretch: [8_000, 14_000], chat: [25_000, 40_000], plant: [12_000, 22_000],
};
const SPOT_KIND: Record<AmbientActivity, string> = { desk: "desk", rest: "sofa", relax: "sofa", coffee: "coffee", window: "window", board: "board", shelf: "shelf", stretch: "desk", chat: "chat", plant: "plant" };
const MOTION: Record<AmbientActivity, PalMotion> = { desk: "idle", relax: "rest", rest: "rest", coffee: "idle", window: "look", board: "look", shelf: "look", stretch: "stretch", chat: "talk", plant: "look" };
/** Plain-language description of an ambient activity (never phrased as work). */
export function ambientDescription(activity: AmbientActivity | "walk", partnerName?: string): string {
 switch (activity) {
  case "desk": return "at their desk";
  case "relax": return "relaxing on the sofa";
  case "rest": return "resting";
  case "coffee": return "getting a drink";
  case "window": return "looking out of the window";
  case "board": return "looking at the whiteboard";
  case "shelf": return "browsing the bookshelf";
  case "stretch": return "stretching";
  case "plant": return "looking at the plants";
  case "chat": return partnerName ? `chatting with ${partnerName}` : "chatting";
  default: return "walking";
 }
}
/** Words ambient descriptions must never contain (they would imply real AI work). */
export const AMBIENT_FORBIDDEN_WORDS = ["working", "coding", "researching", "writing", "running", "task", "responding", "analys", "processing"];

function random(seed: string) {
 let h = 1779033703 ^ seed.length;
 for (let i = 0; i < seed.length; i++) { h = Math.imul(h ^ seed.charCodeAt(i), 3432918353); h = (h << 13) | (h >>> 19); }
 let a = h >>> 0;
 return () => { a = (a + 0x6d2b79f5) >>> 0; let t = a; t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
}
const between = (rand: () => number, [lo, hi]: readonly [number, number]) => Math.round(lo + (hi - lo) * rand());
function pick<T>(rand: () => number, items: readonly { item: T; weight: number }[]): T | undefined {
 const total = items.reduce((sum, x) => sum + Math.max(0, x.weight), 0);
 let roll = rand() * total;
 for (const x of items) { roll -= Math.max(0, x.weight); if (roll <= 0 && x.weight > 0) return x.item; }
 return items.find(x => x.weight > 0)?.item;
}
function walkBetween(from: WorldPoint, to: WorldPoint, theme: CharacterMode, speed: number, start: number): Walk {
 const raw = worldPath(from, to, theme);
 const grid = raw.length > 1 ? worldSmoothPath(raw, theme) : [from, to];
 const path = [from, ...grid.slice(1, -1), to];
 const lengths = path.slice(1).map((p, i) => worldScreenDistance(path[i]!, p));
 const total = lengths.reduce((a, b) => a + b, 0);
 // Cruise at gait speed with a short ease in/out.
 return { kind: "walk", start, end: start + Math.round(total / speed * 1000 / 0.92), path, lengths, total };
}

/**
 * Plan every actor in a room together for one AMBIENT_PERIOD. `night` makes rests likelier.
 * Deterministic for the same inputs (same actors, spots, theme, seed and night flag).
 */
export function ambientSchedule({ theme, actors, spots, chatPairs, seed = "ambient", night = false, period = AMBIENT_PERIOD }: {
 theme: CharacterMode; actors: readonly AmbientActor[]; spots: readonly AmbientSpot[]; chatPairs: readonly (readonly [string, string])[];
 seed?: string; night?: boolean; period?: number;
}): Map<string, AmbientPlan> {
 const byId = new Map(spots.map(x => [x.id, x]));
 const reserved = new Map<string, Array<[number, number]>>();
 const free = (spot: string, a: number, b: number) => !(reserved.get(spot) ?? []).some(([x, y]) => a < y + 2000 && x < b + 2000);
 const reserve = (spot: string, a: number, b: number) => { const list = reserved.get(spot) ?? []; list.push([a, b]); reserved.set(spot, list); };
 // Every actor's home is theirs for the whole loop (own desk; visitors' home seat is not exclusive).
 // Conversations: every ~2.5 minutes two characters meet at a free pair of facing spots.
 const rand = random(seed + ":meetings:" + actors.map(a => a.id).join(","));
 const meetings: Array<{ at: number; a: string; b: string; spots: [string, string]; length: number }> = [];
 if (actors.length >= 2) for (let at = 70_000 + Math.round(rand() * 30_000); at < period - 120_000; at += 120_000 + Math.round(rand() * 70_000)) {
  const a = actors[Math.floor(rand() * actors.length)]!;
  const others = actors.filter(x => x !== a && !meetings.some(m => Math.abs(m.at - at) < 90_000 && (m.a === x.id || m.b === x.id)));
  if (meetings.some(m => Math.abs(m.at - at) < 90_000 && (m.a === a.id || m.b === a.id)) || !others.length) continue;
  const b = others[Math.floor(rand() * others.length)]!;
  const length = between(rand, DURATION.chat);
  const pair = chatPairs.find(([x, y]) => free(x, at - 30_000, at + length) && free(y, at - 30_000, at + length));
  if (!pair) continue;
  reserve(pair[0], at - 30_000, at + length); reserve(pair[1], at - 30_000, at + length);
  meetings.push({ at, a: a.id, b: b.id, spots: [pair[0], pair[1]], length });
 }
 for (const a of actors) if (a.kind === "visitor") { reserve(a.home, 0, 100_000); reserve(a.home, period - 90_000, period); }
 const names = new Map(actors.map(a => [a.id, a.name]));
 const plans = new Map<string, AmbientPlan>();
 for (const actor of actors) {
  const r = random(seed + ":" + actor.id), home = byId.get(actor.home) ?? spots[0]!;
  const segments: AmbientSegment[] = [];
  let t = 0, at: AmbientSpot = home, last: AmbientActivity = actor.kind === "pal" ? "desk" : "relax", streak = 0;
  const mine = meetings.filter(m => m.a === actor.id || m.b === actor.id).sort((x, y) => x.at - y.at);
  const stay = (spot: AmbientSpot, activity: AmbientActivity, start: number, end: number, extra: Partial<Stay> = {}) => {
   if (end <= start) return;
   if (spot.kind !== "desk" && activity !== "chat") reserve(spot.id, start, end);
   segments.push({ kind: "stay", start, end, spot, activity, facing: spot.facing, ...extra });
  };
  // Somewhere free to wait (own desk for Pals; the nearest free spot for visitors).
  const fallback = (from: AmbientSpot, start: number, end: number): AmbientSpot => {
   if (actor.kind === "pal" || (from.id === home.id && free(from.id, start, end + 30_000))) return actor.kind === "pal" ? home : from;
   // Checked over a window that also covers the walk there.
   return [...spots].filter(x => x.kind !== "desk" && x.kind !== "chat").sort((x, y) => worldScreenDistance(from.point, x.point) - worldScreenDistance(from.point, y.point))
    .find(x => free(x.id, start, end + 30_000)) ?? home;
  };
  // Start settled at home.
  const first = Math.min(between(r, actor.kind === "pal" ? [40_000, 90_000] : [30_000, 60_000]), period / 4);
  stay(home, actor.kind === "pal" ? "desk" : "relax", 0, first); t = first;
  const finish = period - 60_000;
  const attended = new Set<number>();
  while (t < finish - 20_000) {
   // The next conversation not yet attended that is still going on (arriving late is fine; never leave a partner alone).
   const meeting = mine.find(m => !attended.has(m.at) && m.at + m.length - 8000 > t);
   if (meeting) {
    const spot = byId.get(meeting.spots[meeting.a === actor.id ? 0 : 1])!;
    const walk = walkBetween(at.point, spot.point, theme, actor.speed, 0);
    const leave = meeting.at - (walk.end - walk.start);
    if (leave - t < 20_000) {
     // Stay put until it is time to go and talk.
     if (leave > t) {
      const wait = fallback(at, t, leave);
      if (wait.id !== at.id) { const w = walkBetween(at.point, wait.point, theme, actor.speed, t); segments.push(w); t = w.end; at = wait; }
      if (leave > t) { stay(at, at.kind === "desk" ? "desk" : "relax", t, leave); t = leave; }
     }
     const w = walkBetween(at.point, spot.point, theme, actor.speed, t);
     segments.push(w);
     attended.add(meeting.at);
     const partner = meeting.a === actor.id ? meeting.b : meeting.a;
     const end = Math.max(w.end + 4000, meeting.at + meeting.length);
     const partnerSpot = byId.get(meeting.spots[meeting.a === actor.id ? 1 : 0])!;
     stay(spot, "chat", w.end, end, { partner, partnerName: names.get(partner) ?? "", facing: worldHeadingOf(partnerSpot.point.x - spot.point.x, partnerSpot.point.y - spot.point.y) });
     t = end; at = spot; last = "chat"; streak++;
     continue;
    }
   }
   // Choose the next stay: Pals drift back to their own desk; nights bring longer rests.
   const options: Array<{ item: AmbientActivity; weight: number }> = actor.kind === "pal" ? [
    { item: "desk", weight: last === "desk" ? 1.2 : 5 }, { item: "relax", weight: 1.4 }, { item: "coffee", weight: 1.2 }, { item: "window", weight: 1 },
    { item: "board", weight: 0.9 }, { item: "shelf", weight: 0.7 }, { item: "rest", weight: night ? 3 : streak > 4 ? 1.5 : 0.6 }, { item: "stretch", weight: last === "desk" ? 0.8 : 0 }, { item: "plant", weight: 0.4 },
   ] : [
    { item: "relax", weight: 2 }, { item: "coffee", weight: 1.5 }, { item: "window", weight: 1.5 }, { item: "board", weight: 0.7 },
    { item: "shelf", weight: 1 }, { item: "rest", weight: night ? 2.5 : 0.8 }, { item: "plant", weight: 0.6 },
   ];
   const activity = pick(r, options) ?? "desk";
   const length = between(r, DURATION[activity]);
   let target: AmbientSpot | undefined;
   if (activity === "desk" || activity === "stretch") target = actor.kind === "pal" ? home : undefined;
   else {
    const candidates = spots.filter(x => x.kind === SPOT_KIND[activity]);
    const start = r() * candidates.length;
    for (let i = 0; i < candidates.length && !target; i++) {
     const c = candidates[(Math.floor(start) + i) % candidates.length]!;
     const w = walkBetween(at.point, c.point, theme, actor.speed, t);
     if (free(c.id, w.end, w.end + length)) target = c;
    }
   }
   if (!target) {
    const wait = fallback(at, t, t + 15_000);
    if (wait.id !== at.id) { const w = walkBetween(at.point, wait.point, theme, actor.speed, t); segments.push(w); t = w.end; at = wait; }
    stay(at, at.kind === "desk" ? "desk" : "relax", t, t + 15_000); t += 15_000; last = at.kind === "desk" ? "desk" : "relax"; continue;
   }
   const walk = target.id === at.id ? null : walkBetween(at.point, target.point, theme, actor.speed, t);
   if (walk) segments.push(walk);
   const arrive = walk ? walk.end : t;
   let end = Math.min(arrive + length, finish);
   const next = mine.find(m => !attended.has(m.at) && m.at >= t);
   if (next) end = Math.min(end, next.at - 25_000);
   if (end <= arrive + 5000) end = arrive + 5000;
   if (target.id !== home.id) reserve(target.id, arrive, end);
   stay(target, activity, arrive, end);
   streak = activity === "desk" || activity === "rest" ? 0 : streak + 1;
   t = end; at = target; last = activity;
  }
  // Close the loop at home so the schedule repeats seamlessly.
  if (at.id !== home.id) { const w = walkBetween(at.point, home.point, theme, actor.speed, t); segments.push(w); t = w.end; }
  if (t < period) stay(home, actor.kind === "pal" ? "desk" : "relax", t, period);
  plans.set(actor.id, { id: actor.id, period, segments });
 }
 return plans;
}

/** Where an actor is at `time` (wraps around the period). */
export function ambientPose(plan: AmbientPlan, time: number): AmbientPose {
 const t = ((Number.isFinite(time) ? time : 0) % plan.period + plan.period) % plan.period;
 let lo = 0, hi = plan.segments.length - 1;
 while (lo < hi) { const mid = (lo + hi + 1) >> 1; if (plan.segments[mid]!.start <= t) lo = mid; else hi = mid - 1; }
 const seg = plan.segments[lo]!;
 if (seg.kind === "stay") {
  const greeting = seg.activity === "chat" && t - seg.start < 1500;
  return { x: seg.spot.point.x, y: seg.spot.point.y, facing: seg.facing, walking: false, activity: seg.activity, motion: greeting ? "wave" : MOTION[seg.activity], spot: seg.spot.id,
   ...(seg.partner ? { partner: seg.partner, partnerName: seg.partnerName ?? "" } : {}) };
 }
 const span = Math.max(1, seg.end - seg.start), u = Math.max(0, Math.min(1, (t - seg.start) / span));
 // Trapezoid speed profile: accelerate over the first 8 %, cruise, decelerate over the last 8 % (continuous).
 const a = 0.08, norm = 1 - a;
 const eased = u < a ? (u * u) / (2 * a * norm) : u > 1 - a ? 1 - ((1 - u) * (1 - u)) / (2 * a * norm) : (u - a / 2) / norm;
 let left = Math.max(0, Math.min(1, eased)) * seg.total;
 for (let i = 0; i < seg.lengths.length; i++) {
  const len = seg.lengths[i]!, a = seg.path[i]!, b = seg.path[i + 1]!;
  if (left <= len || i === seg.lengths.length - 1) {
   const k = len ? Math.max(0, Math.min(1, left / len)) : 1;
   return { x: a.x + (b.x - a.x) * k, y: a.y + (b.y - a.y) * k, facing: worldHeadingOf(b.x - a.x, b.y - a.y), walking: seg.total > 0 && u < 1, activity: "walk", motion: "walk" };
  }
  left -= len;
 }
 const end = seg.path[seg.path.length - 1]!;
 return { x: end.x, y: end.y, facing: "s", walking: false, activity: "walk", motion: "idle" };
}

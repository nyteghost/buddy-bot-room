import { describe, expect, it } from "vitest";
import { WORLD_CROWD_PRIORITY, WorldCrowd, worldCrowdFootprint, worldCrowdTieBreak, type WorldCrowdMember, type WorldCrowdPlan } from "@/lib/world-crowd";
import { WORLD_SCENE_ASPECT, worldPath, worldPointIsWalkable, worldScreenDistance, type WorldPoint } from "@/lib/world-floor";
import { worldPose } from "@/lib/world-navigation";
import { guestStart, guestWanderPose } from "@/lib/world-guest-packs";
import { WORLD_GAITS, type WorldGait } from "@/lib/world-wander";
import type { CharacterMode } from "@/lib/hellraiser";
import type { AgentId } from "@/lib/agents";

const PALS: AgentId[] = ["nova", "byte", "sage", "pip", "echo", "rune", "claude", "saiyan", "mimic"];
const GAITS: WorldGait[] = ["humanoid", "humanoid", "quadruped", "humanoid", "floating", "humanoid"];
const foot = worldCrowdFootprint(1);

/** A straight there-and-stop route at `speed` screen %/s, starting after `delay` ms. */
function line(from: WorldPoint, to: WorldPoint, speed = 5, delay = 0): WorldCrowdPlan {
 const length = worldScreenDistance(from, to);
 return time => {
  const r = Math.max(0, Math.min(1, (time - delay) * speed / 1000 / length));
  return { x: from.x + (to.x - from.x) * r, y: from.y + (to.y - from.y) * r, walking: r > 0 && r < 1, facing: to.x >= from.x ? "e" : "w" };
 };
}
const member = (id: string, plan: WorldCrowdPlan | undefined, priority: number = WORLD_CROWD_PRIORITY.visitor, speed = 5): WorldCrowdMember =>
 ({ id, priority: priority + worldCrowdTieBreak(id), ...foot, speed, ...(plan ? { plan } : {}) });
function stressCast(theme: CharacterMode, visitors = 6): WorldCrowdMember[] {
 return [
  ...PALS.map((id, index) => member("pal:" + id, time => { const p = worldPose(id, index, time, theme); return { x: p.x, y: p.y, walking: p.walking, facing: p.heading }; }, WORLD_CROWD_PRIORITY.pal)),
  ...Array.from({ length: visitors }, (_, slot) => {
   const id = "user-crowdtest" + slot, gait = GAITS[slot % GAITS.length]!;
   return member("custom:" + id, time => { const p = guestWanderPose(id, slot + 8, theme, time, gait); return { x: p.x, y: p.y, walking: p.walking, facing: p.facing }; }, WORLD_CROWD_PRIORITY.visitor, WORLD_GAITS[gait].speed);
  }),
 ];
}
type Stats = { minSpacing: number; maxStepRatio: number; offFloor: number; stuckMs: number; progress: number[]; final: string };
/** Fixed-step simulation (every actor advances `dt` per frame, in a stable order). */
function simulate(theme: CharacterMode, cast: WorldCrowdMember[], ms: number, dt = 100, settle = 5000): Stats {
 const crowd = new WorldCrowd(theme);
 cast.forEach(m => crowd.join(m, 0, 0));
 const stats: Stats = { minSpacing: Infinity, maxStepRatio: 0, offFloor: 0, stuckMs: 0, progress: [], final: "" };
 const stuck = new Map<string, number>();
 for (let now = 0; now < ms; now += dt) {
  for (const m of cast) {
   const before = crowd.pose(m.id)!, after = crowd.advance(m.id, dt, now)!;
   stats.maxStepRatio = Math.max(stats.maxStepRatio, worldScreenDistance(before, after) / (m.speed * dt / 1000));
   if (!worldPointIsWalkable(after, theme)) stats.offFloor++;
   const routeMoves = m.plan!(after.time).walking || after.lag > 2;
   const run = !after.walking && routeMoves ? (stuck.get(m.id) ?? 0) + dt : 0;
   stuck.set(m.id, run); stats.stuckMs = Math.max(stats.stuckMs, run);
  }
  if (now >= settle) for (let i = 0; i < cast.length; i++) for (let j = i + 1; j < cast.length; j++) stats.minSpacing = Math.min(stats.minSpacing, crowd.spacing(cast[i]!.id, cast[j]!.id));
 }
 stats.progress = cast.map(m => crowd.pose(m.id)!.time / ms);
 stats.final = cast.map(m => { const p = crowd.pose(m.id)!; return `${m.id}:${p.x.toFixed(4)},${p.y.toFixed(4)},${p.time}`; }).join("|");
 return stats;
}
// A spacing value below 1 means the two feet footprints overlap. 0.36 = closer than 60% of the normal gap
// (the last-resort shoulder brush after 10 s stuck never goes below that).
const NO_WALK_THROUGH = 0.36;

describe("Living World crowd: actors never walk through each other", () => {
 it("two actors walking head-on pass each other without touching (keep right)", () => {
  const crowd = new WorldCrowd("matrix");
  const a = member("visitor:a", line({ x: 20, y: 87 }, { x: 80, y: 87 })), b = member("visitor:b", line({ x: 80, y: 87 }, { x: 20, y: 87 }));
  crowd.join(a, 0, 0); crowd.join(b, 0, 0);
  let min = Infinity;
  for (let now = 0; now < 20000; now += 100) { crowd.advance(a.id, 100, now); crowd.advance(b.id, 100, now); min = Math.min(min, crowd.spacing(a.id, b.id)); }
  expect(min).toBeGreaterThanOrEqual(1 - 1e-9);
  expect(crowd.pose(a.id)!.x).toBeCloseTo(80, 1);
  expect(crowd.pose(b.id)!.x).toBeCloseTo(20, 1);
 });

 it("gets through the horror mansion's narrow pocket behind the armchairs", () => {
  const crowd = new WorldCrowd("horror");
  const a = member("visitor:a", line({ x: 40, y: 52 }, { x: 57, y: 52 })), b = member("visitor:b", line({ x: 57, y: 50 }, { x: 40, y: 50 }));
  crowd.join(a, 0, 0); crowd.join(b, 0, 0);
  let min = Infinity;
  for (let now = 0; now < 25000; now += 100) {
   for (const m of [a, b]) expect(worldPointIsWalkable(crowd.advance(m.id, 100, now)!, "horror")).toBe(true);
   min = Math.min(min, crowd.spacing(a.id, b.id));
  }
  expect(min).toBeGreaterThanOrEqual(1 - 1e-9);
  expect(worldScreenDistance(crowd.pose(a.id)!, { x: 57, y: 52 })).toBeLessThan(0.05);
  expect(worldScreenDistance(crowd.pose(b.id)!, { x: 40, y: 50 })).toBeLessThan(0.05);
 });

 it("stops beside an occupied goal, then takes it once it is free", () => {
  const crowd = new WorldCrowd("matrix"), goal = { x: 50, y: 87 };
  const sitter = member("pal:sitter", () => ({ ...goal, walking: false, facing: "s" }), WORLD_CROWD_PRIORITY.pal);
  const walker = member("visitor:walker", line({ x: 20, y: 87 }, goal));
  crowd.join(sitter, 0, 0); crowd.join(walker, 0, 0);
  for (let now = 0; now < 15000; now += 100) { crowd.advance(sitter.id, 100, now); crowd.advance(walker.id, 100, now); expect(crowd.spacing(sitter.id, walker.id)).toBeGreaterThanOrEqual(1 - 1e-9); }
  const waiting = crowd.pose(walker.id)!;
  expect(waiting.walking).toBe(false);
  expect(worldScreenDistance(waiting, goal)).toBeLessThan(6);
  crowd.leave(sitter.id);
  for (let now = 15000; now < 20000; now += 100) crowd.advance(walker.id, 100, now);
  expect(worldScreenDistance(crowd.pose(walker.id)!, goal)).toBeLessThan(0.05);
 });

 it("a lower-priority actor makes way for a Pal standing in its way instead of both waiting", () => {
  const crowd = new WorldCrowd("matrix");
  const pal = member("pal:a", line({ x: 20, y: 87 }, { x: 80, y: 87 }), WORLD_CROWD_PRIORITY.pal);
  const guest = member("guest:b", () => ({ x: 50, y: 87, walking: false, facing: "s" }), WORLD_CROWD_PRIORITY.guest);
  crowd.join(pal, 0, 0); crowd.join(guest, 0, 0);
  for (let now = 0; now < 20000; now += 100) { crowd.advance(pal.id, 100, now); crowd.advance(guest.id, 100, now); expect(crowd.spacing(pal.id, guest.id)).toBeGreaterThanOrEqual(1 - 1e-9); }
  expect(crowd.pose(pal.id)!.x).toBeCloseTo(80, 1);
 });

 it("walks around desk-choreography Pals and paused actors without moving them", () => {
  const crowd = new WorldCrowd("matrix");
  const desk = member("pal:desk", undefined, WORLD_CROWD_PRIORITY.pal), frozen = member("visitor:frozen", () => ({ x: 62, y: 87, walking: false, facing: "s" }));
  const walker = member("visitor:walker", line({ x: 20, y: 87 }, { x: 80, y: 87 }));
  crowd.place(desk, 40, 87, 0); crowd.join(frozen, 0, 0); crowd.join(walker, 0, 0); crowd.setPaused(frozen.id, true, 0);
  for (let now = 0; now < 30000; now += 100) {
   crowd.place(desk, 40, 87, now); crowd.setPaused(frozen.id, true, now);
   crowd.advance(walker.id, 100, now);
   expect(crowd.spacing(walker.id, desk.id)).toBeGreaterThanOrEqual(1 - 1e-9);
   expect(crowd.spacing(walker.id, frozen.id)).toBeGreaterThanOrEqual(1 - 1e-9);
  }
  expect(crowd.pose(desk.id)).toMatchObject({ x: 40, y: 87, mode: "fixed" });
  expect(crowd.pose(frozen.id)).toMatchObject({ x: 62, y: 87 });
  expect(crowd.pose(walker.id)!.x).toBeCloseTo(80, 1);
 });

 it("never turns a long frame gap into a jump", () => {
  const crowd = new WorldCrowd("matrix"), a = member("visitor:a", line({ x: 20, y: 87 }, { x: 80, y: 87 }));
  crowd.join(a, 0, 0);
  const p = crowd.advance(a.id, 60_000, 0)!;
  expect(worldScreenDistance({ x: 20, y: 87 }, p)).toBeLessThanOrEqual(5 * 0.25 * 1.25 + 1e-9);
 });

 it("handles departures, re-entry and removing an actor mid-push", () => {
  const theme: CharacterMode = "horror", cast = stressCast(theme), crowd = new WorldCrowd(theme);
  cast.forEach(m => crowd.join(m, 0, 0));
  const run = (from: number, to: number, list: WorldCrowdMember[]) => { for (let now = from; now < to; now += 100) for (const m of list) crowd.advance(m.id, 100, now); };
  run(0, 20000, cast);
  const gone = cast.slice(-2), staying = cast.slice(0, -2);
  gone.forEach(m => crowd.leave(m.id));
  expect(crowd.size).toBe(staying.length);
  const before = new Map(staying.map(m => [m.id, crowd.pose(m.id)!]));
  run(20000, 20100, staying);
  for (const m of staying) expect(worldScreenDistance(before.get(m.id)!, crowd.pose(m.id)!)).toBeLessThanOrEqual(m.speed * 0.1 * 1.5);
  // Re-entry at its current route point; overlaps from entering resolve without anyone jumping.
  crowd.join(gone[0]!, 20100, 20100);
  const back = [...staying, gone[0]!];
  run(20100, 26000, back);
  for (let i = 0; i < back.length; i++) for (let j = i + 1; j < back.length; j++) expect(crowd.spacing(back[i]!.id, back[j]!.id)).toBeGreaterThanOrEqual(NO_WALK_THROUGH);
  expect(crowd.ids()).not.toContain(gone[1]!.id);
 });

 it("is deterministic", () => {
  const a = simulate("matrix", stressCast("matrix"), 30000), b = simulate("matrix", stressCast("matrix"), 30000);
  expect(a.final).toBe(b.final);
 });
});

describe("Living World crowd: nine Pals and six active visitors (stress)", () => {
 for (const theme of ["horror", "matrix", "hellraiser"] as const) {
  it(`${theme}: no walking through, always on the floor, no jumps, no deadlock`, () => {
   const s = simulate(theme, stressCast(theme), 90000);
   expect(s.minSpacing).toBeGreaterThanOrEqual(NO_WALK_THROUGH);
   expect(s.offFloor).toBe(0);
   expect(s.maxStepRatio).toBeLessThanOrEqual(1.5);
   expect(s.stuckMs).toBeLessThan(30000);
   const sorted = [...s.progress].sort((x, y) => x - y);
   expect(sorted[0]!).toBeGreaterThan(0.2);
   expect(sorted[Math.floor(sorted.length / 2)]!).toBeGreaterThan(0.6);
  }, 30000);
 }
 it("phone-size footprints keep the same guarantees in the horror mansion", () => {
  const phone = worldCrowdFootprint(1, true), cast = stressCast("horror").map(m => ({ ...m, ...phone }));
  const s = simulate("horror", cast, 60000);
  expect(s.minSpacing).toBeGreaterThanOrEqual(NO_WALK_THROUGH);
  expect(s.offFloor).toBe(0);
  expect(s.stuckMs).toBeLessThan(30000);
 }, 30000);
});

describe("crowd-aware floor helpers and calibration", () => {
 it("worldPath can route around temporarily blocked cells", () => {
  const from = { x: 20, y: 87 }, to = { x: 80, y: 87 };
  const plain = worldPath(from, to, "matrix"), around = worldPath(from, to, "matrix", p => Math.abs(p.x - 50) < 4 && p.y > 84);
  expect(plain.some(p => Math.abs(p.x - 50) < 4 && p.y > 84)).toBe(true);
  expect(around.length).toBeGreaterThan(1);
  expect(around.some(p => Math.abs(p.x - 50) < 4 && p.y > 84)).toBe(false);
 });
 it("footprints scale with body size and are larger on phones", () => {
  expect(worldCrowdFootprint(0.6).rx).toBeLessThan(worldCrowdFootprint(1).rx);
  expect(worldCrowdFootprint(1, true).rx).toBeGreaterThan(worldCrowdFootprint(1).rx);
  expect(worldCrowdFootprint(1).ry).toBeLessThan(worldCrowdFootprint(1).rx);
 });
 it("spreads imported visitors over the horror mansion's separate floor pockets, off the Pal homes", () => {
  const pocket = (p: WorldPoint) => p.y < 60 ? (p.x < 60 ? "back-left" : "back-right") : p.x > 88 ? "right" : "front";
  const starts = [8, 9, 10, 11, 12, 13].map(slot => guestStart(slot, "horror"));
  expect(new Set(starts.map(pocket)).size).toBe(4);
  expect(starts.every(p => worldPointIsWalkable(p, "horror"))).toBe(true);
  const homes = [{ x: 41, y: 52 }, { x: 53, y: 52 }, { x: 77, y: 52 }, { x: 83, y: 52 }, { x: 44, y: 89 }, { x: 56, y: 89 }, { x: 50, y: 92 }, { x: 47, y: 52 }, { x: 74, y: 52 }];
  expect(starts.some(s => homes.some(h => h.x === s.x && h.y === s.y))).toBe(false);
  void WORLD_SCENE_ASPECT;
 });
});

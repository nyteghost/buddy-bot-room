import { describe, expect, it } from "vitest";
import { WORLD_ISO_CROWD_MAX, createWorldIsoCrowd, type WorldIsoCrowd, type WorldIsoCrowdEvent } from "@/lib/world-iso-crowd";
import { WORLD_ISO_GREYBOX } from "@/lib/world-iso-greybox";
import { WORLD_ISO_FOOTPRINT, worldIsoPath, worldIsoPathLength, worldIsoPointFree, worldIsoSealPlan, type GroundPlan } from "@/lib/world-iso-ground";

const G = WORLD_ISO_GREYBOX, GAP = 2 * WORLD_ISO_FOOTPRINT, DT = 1000 / 60;
const anchor = (plan: GroundPlan, id: string) => plan.anchors.find(a => a.id === id)!;
const seal = (raw: unknown) => { const p = worldIsoSealPlan(raw); if (!p) throw new Error("test plan did not seal"); return p; };
type Watch = { minGap: number; clipped: number; maxStep: number; events: WorldIsoCrowdEvent[]; facings: Set<string> };
/** Step a crowd for `seconds`, checking the safety rules on every frame. Stops early when `until` is true. */
function run(crowd: WorldIsoCrowd, plan: GroundPlan, seconds: number, until?: () => boolean, watch: Watch = { minGap: Infinity, clipped: 0, maxStep: 0, events: [], facings: new Set() }): Watch & { elapsed: number } {
 let before = new Map(crowd.actors().filter(a => a.present).map(a => [a.id, a])), elapsed = 0;
 for (let i = 0; i < seconds * 60; i++) {
  crowd.step(DT); elapsed += DT;
  watch.events.push(...crowd.drain());
  const now = crowd.actors().filter(a => a.present);
  for (let p = 0; p < now.length; p++) {
   const a = now[p]!;
   if (!worldIsoPointFree(plan, { u: a.u, v: a.v })) watch.clipped++;
   if (a.moving) watch.facings.add(a.facing);
   const was = before.get(a.id);
   if (was) watch.maxStep = Math.max(watch.maxStep, Math.hypot(a.u - was.u, a.v - was.v));
   for (let q = p + 1; q < now.length; q++) watch.minGap = Math.min(watch.minGap, Math.hypot(a.u - now[q]!.u, a.v - now[q]!.v));
  }
  before = new Map(now.map(a => [a.id, a]));
  if (until?.()) break;
 }
 return { ...watch, elapsed };
}
const safe = (w: Watch) => { expect(w.clipped).toBe(0); expect(w.minGap).toBeGreaterThanOrEqual(GAP - 1e-9); expect(w.maxStep).toBeLessThanOrEqual(1.6 * DT / 1000 + 1e-9); };
const at = (crowd: WorldIsoCrowd, id: string) => crowd.actors().find(a => a.id === id)!;
const allArrived = (crowd: WorldIsoCrowd, targets: Record<string, string>) => () => Object.entries(targets).every(([id, where]) => at(crowd, id).at === where);

/** Two rooms joined by one straight passage exactly one lane wide (0.7 tile): nobody can pass inside it. */
const CORRIDOR = seal({
 id: "corridor", floor: [{ u: 0, v: 0 }, { u: 14, v: 0 }, { u: 14, v: 6 }, { u: 0, v: 6 }],
 colliders: [{ id: "north", u1: 4, v1: 0, u2: 10, v2: 2.65 }, { id: "south", u1: 4, v1: 3.35, u2: 10, v2: 6 }],
 anchors: [
  { id: "door", kind: "door", at: { u: 1, v: 5 }, facing: "n" }, { id: "west", kind: "visitor", at: { u: 2, v: 3 }, facing: "e" }, { id: "east", kind: "visitor", at: { u: 12, v: 3 }, facing: "w" },
  { id: "west-2", kind: "visitor", at: { u: 2, v: 1 }, facing: "e" }, { id: "east-2", kind: "visitor", at: { u: 12, v: 1 }, facing: "w" },
 ], door: "door",
});

describe("crowd: setup and single walks (Stage 2)", () => {
 it("refuses unsealed plans, unsupported radii and speeds, and bad joins", () => {
  expect(createWorldIsoCrowd(JSON.parse(JSON.stringify(G)) as GroundPlan)).toBeNull();
  for (const radius of [Number.NaN, 0, -1, 5, Infinity]) expect(createWorldIsoCrowd(G, { radius })).toBeNull();
  for (const speed of [Number.NaN, 0, -1, Infinity, 99]) expect(createWorldIsoCrowd(G, { speed })).toBeNull();
  const crowd = createWorldIsoCrowd(G)!;
  expect(crowd.join({ id: "a", rank: 1, at: "visitor-home-0" })).toBe(true);
  expect(crowd.join({ id: "a", rank: 1, at: "visitor-home-1" })).toBe(false);   // same id twice
  expect(crowd.join({ id: "b", rank: 1, at: "visitor-home-0" })).toBe(false);   // spot taken
  expect(crowd.join({ id: "c", rank: 1, at: "nowhere" })).toBe(false);
  expect(crowd.join({ id: "d", rank: Number.NaN, at: "visitor-home-1" })).toBe(false);
  expect(crowd.send("a", "nowhere")).toBe(false);
  expect(crowd.send("nobody", "sofa-1")).toBe(false);
  for (let i = 0; i < 20; i++) crowd.join({ id: `out-${i}`, rank: 1, at: null });
  expect(crowd.actors()).toHaveLength(WORLD_ISO_CROWD_MAX);
 });

 it("walks one character to an anchor: verified route, steady speed, exact arrival, anchor facing", () => {
  const crowd = createWorldIsoCrowd(G)!;
  crowd.join({ id: "nova", rank: 200, at: "stand-desk-0" });
  expect(crowd.send("nova", "sofa-2", "stand-desk-0")).toBe(true);
  const w = run(crowd, G, 60, () => at(crowd, "nova").at === "sofa-2");
  safe(w);
  const a = at(crowd, "nova"), sofa = anchor(G, "sofa-2");
  expect([a.u, a.v]).toEqual([sofa.at.u, sofa.at.v]);
  expect(a.facing).toBe(sofa.facing);
  expect(a.status).toBe("idle"); expect(a.target).toBeNull();
  const direct = worldIsoPathLength(worldIsoPath(G, anchor(G, "stand-desk-0").at, sofa.at)!);
  expect(Math.abs(a.walked - direct)).toBeLessThan(1e-6);                  // walked exactly the engine's route
  expect(Math.abs(w.elapsed / 1000 - direct / 1.6)).toBeLessThan(0.1);     // at 1.6 tiles per second
  expect(w.events.map(e => e.type)).toEqual(["arrived"]);
  expect(w.facings.size).toBeGreaterThan(1);
 });

 it("is deterministic: the same joins, sends and steps give identical positions", () => {
  const play = () => {
   const crowd = createWorldIsoCrowd(G)!;
   for (let i = 0; i < 9; i++) crowd.join({ id: `p${i}`, rank: 200, at: `stand-desk-${i}` });
   for (let i = 0; i < 6; i++) crowd.join({ id: `v${i}`, rank: 100, at: `visitor-home-${i}` });
   ["sofa-1", "coffee-2", "window-1", "board-2", "shelf-1", "chat-a1", "chat-a2", "plant-1", "sofa-3"].forEach((to, i) => crowd.send(`p${i}`, to, `stand-desk-${i}`));
   const trace: string[] = [];
   for (let i = 0; i < 900; i++) { crowd.step(DT); if (i % 30 === 0) trace.push(JSON.stringify(crowd.actors())); }
   return trace.join("\n");
  };
  expect(play()).toBe(play());
 });

 it("ignores bad step sizes and limits a very long step", () => {
  const crowd = createWorldIsoCrowd(G)!;
  crowd.join({ id: "nova", rank: 200, at: "stand-desk-0" });
  crowd.send("nova", "plant-1");
  const start = JSON.stringify(crowd.actors());
  for (const dt of [Number.NaN, -5, 0, Infinity, -Infinity]) crowd.step(dt);
  expect(JSON.stringify(crowd.actors())).toBe(start);
  crowd.step(60_000); // a tab that slept for a minute: at most a quarter of a second of walking
  expect(at(crowd, "nova").walked).toBeLessThanOrEqual(1.6 * 0.25 + 1e-9);
 });
});

describe("crowd: congestion scenarios (Stage 2)", () => {
 it("doorway rush: six visitors come in one at a time and all reach their homes", () => {
  const crowd = createWorldIsoCrowd(G)!, targets: Record<string, string> = {};
  for (let i = 0; i < 6; i++) { crowd.join({ id: `v${i}`, rank: 100, at: null }); crowd.send(`v${i}`, `visitor-home-${i}`); targets[`v${i}`] = `visitor-home-${i}`; }
  expect(crowd.actors().every(a => !a.present && a.status === "outside")).toBe(true);
  crowd.step(DT); crowd.drain();
  expect(crowd.actors().filter(a => a.present)).toHaveLength(1); // only one fits in the doorway
  const w = run(crowd, G, 90, allArrived(crowd, targets));
  safe(w);
  expect(allArrived(crowd, targets)()).toBe(true);
  expect(w.events.filter(e => e.type === "entered")).toHaveLength(5); // the first came in on the step above
  expect(w.events.filter(e => e.type === "parked" || e.type === "fallback")).toHaveLength(0);
 }, 60_000);

 it("desk rush: nine Pals leave the lounge at once for their own workstations", () => {
  const crowd = createWorldIsoCrowd(G)!, targets: Record<string, string> = {};
  const lounge = ["sofa-1", "sofa-2", "sofa-3", "chat-a1", "chat-a2", "chat-d1", "chat-d2", "shelf-1", "visitor-home-1"];
  lounge.forEach((from, i) => { expect(crowd.join({ id: `p${i}`, rank: 200, at: from })).toBe(true); });
  lounge.forEach((_, i) => { crowd.send(`p${i}`, `stand-desk-${i}`); targets[`p${i}`] = `stand-desk-${i}`; });
  const w = run(crowd, G, 120, allArrived(crowd, targets));
  safe(w);
  expect(allArrived(crowd, targets)()).toBe(true);
  expect(crowd.stats().longestStallMs).toBeLessThan(25_000);
 }, 60_000);

 it("desk approach: a Pal with sitting art reaches the seat behind its desk, one without uses the standing fallback", () => {
  const crowd = createWorldIsoCrowd(G)!;
  crowd.join({ id: "sits", rank: 200, at: "sofa-1" }); crowd.join({ id: "stands", rank: 200, at: "sofa-3" });
  crowd.send("sits", "seat-4", "stand-desk-4"); crowd.send("stands", "stand-desk-7");
  const w = run(crowd, G, 90, () => at(crowd, "sits").at === "seat-4" && at(crowd, "stands").at === "stand-desk-7");
  safe(w);
  expect(at(crowd, "sits").facing).toBe("se"); // seated Pals face the viewer
  expect(at(crowd, "stands").at).toBe("stand-desk-7");
 });

 it("head-on in a one-lane passage: the lower rank backs out, both arrive, nobody overlaps", () => {
  const crowd = createWorldIsoCrowd(CORRIDOR)!;
  crowd.join({ id: "pal", rank: 200, at: "west" }); crowd.join({ id: "visitor", rank: 100, at: "east" });
  crowd.send("pal", "east", "west-2"); crowd.send("visitor", "west", "east-2");
  const done = () => at(crowd, "pal").at === "east" && at(crowd, "visitor").at === "west";
  const w = run(crowd, CORRIDOR, 180, done);
  safe(w);
  expect(done()).toBe(true);
  expect(crowd.stats().backOffs).toBeGreaterThan(0);
  expect(w.events.filter(e => e.type === "parked")).toHaveLength(0);
 }, 60_000);

 it("someone standing on the route: the walker goes round and the bystander is not pushed", () => {
  const crowd = createWorldIsoCrowd(G)!, from = anchor(G, "visitor-home-0").at, to = anchor(G, "visitor-home-3").at;
  // Park a bystander on the straight line between two visitor homes.
  const mid = seal({ ...JSON.parse(JSON.stringify(G)), anchors: [...JSON.parse(JSON.stringify(G.anchors)), { id: "mid", kind: "visitor", at: { u: (from.u + to.u) / 2, v: (from.v + to.v) / 2 }, facing: "s" }] });
  const c2 = createWorldIsoCrowd(mid)!;
  c2.join({ id: "bystander", rank: 100, at: "mid" }); c2.join({ id: "walker", rank: 200, at: "visitor-home-0" });
  c2.send("walker", "visitor-home-3");
  const w = run(c2, mid, 60, () => at(c2, "walker").at === "visitor-home-3");
  safe(w);
  expect(at(c2, "walker").at).toBe("visitor-home-3");
  expect(at(c2, "bystander").walked).toBe(0);
  expect(at(c2, "walker").walked).toBeGreaterThan(Math.hypot(to.u - from.u, to.v - from.v)); // longer than the straight line
  expect(crowd.actors()).toHaveLength(0);
 });

 it("blocked destination: waits, then uses the fallback; with no fallback it parks instead of waiting forever", () => {
  const crowd = createWorldIsoCrowd(G)!;
  crowd.join({ id: "owner", rank: 100, at: "sofa-2" });
  crowd.join({ id: "withFallback", rank: 200, at: "stand-desk-0" }); crowd.join({ id: "noFallback", rank: 200, at: "stand-desk-1" });
  crowd.send("withFallback", "sofa-2", "stand-desk-0"); crowd.send("noFallback", "sofa-2");
  const w = run(crowd, G, 120, () => at(crowd, "withFallback").at === "stand-desk-0" && at(crowd, "noFallback").status === "parked");
  safe(w);
  expect(at(crowd, "owner").at).toBe("sofa-2"); expect(at(crowd, "owner").walked).toBe(0);
  expect(at(crowd, "withFallback").at).toBe("stand-desk-0");
  expect(at(crowd, "noFallback").status).toBe("parked"); expect(at(crowd, "noFallback").target).toBeNull();
  expect(w.events.some(e => e.type === "fallback" && e.actor === "withFallback")).toBe(true);
  expect(w.events.some(e => e.type === "parked" && e.actor === "noFallback")).toBe(true);
  expect(crowd.stats().longestStallMs).toBeLessThan(25_000);
  // A parked character can be sent somewhere else afterwards.
  crowd.send("noFallback", "stand-desk-1");
  run(crowd, G, 60, () => at(crowd, "noFallback").at === "stand-desk-1");
  expect(at(crowd, "noFallback").at).toBe("stand-desk-1");
 }, 60_000);

 it("unreachable destination: gives up at once and uses the fallback", () => {
  const island = seal({ ...JSON.parse(JSON.stringify(CORRIDOR)), colliders: [{ id: "wall", u1: 4, v1: 0, u2: 10, v2: 6 }] });
  const crowd = createWorldIsoCrowd(island)!;
  crowd.join({ id: "a", rank: 100, at: "west" });
  crowd.send("a", "east", "west-2");
  const w = run(crowd, island, 30, () => at(crowd, "a").at === "west-2");
  safe(w);
  expect(at(crowd, "a").at).toBe("west-2");
  expect(w.events.filter(e => e.type === "fallback")).toHaveLength(1);
 });
});

describe("crowd: pause and reduced motion (Stage 2)", () => {
 it("paused: nothing changes", () => {
  const crowd = createWorldIsoCrowd(G)!;
  crowd.join({ id: "nova", rank: 200, at: "stand-desk-0" }); crowd.send("nova", "sofa-2");
  for (let i = 0; i < 30; i++) crowd.step(DT);
  const frozen = JSON.stringify(crowd.actors());
  for (let i = 0; i < 600; i++) crowd.step(DT, { paused: true });
  expect(JSON.stringify(crowd.actors())).toBe(frozen);
 });

 it("reduced motion: nobody walks; characters appear at free destinations and wait for taken ones", () => {
  const crowd = createWorldIsoCrowd(G)!;
  crowd.join({ id: "owner", rank: 100, at: "sofa-2" }); crowd.join({ id: "nova", rank: 200, at: "stand-desk-0" }); crowd.join({ id: "byte", rank: 200, at: "stand-desk-1" }); crowd.join({ id: "late", rank: 100, at: null });
  crowd.send("nova", "coffee-1"); crowd.send("byte", "sofa-2", "stand-desk-1"); crowd.send("late", "visitor-home-0");
  let moved = false, minGap = Infinity;
  for (let i = 0; i < 60 * 30; i++) {
   crowd.step(DT, { reduced: true });
   const now = crowd.actors().filter(a => a.present);
   moved ||= now.some(a => a.moving);
   for (let p = 0; p < now.length; p++) for (let q = p + 1; q < now.length; q++) minGap = Math.min(minGap, Math.hypot(now[p]!.u - now[q]!.u, now[p]!.v - now[q]!.v));
  }
  expect(moved).toBe(false);
  expect(minGap).toBeGreaterThanOrEqual(GAP - 1e-9);
  expect(at(crowd, "nova").at).toBe("coffee-1"); expect(at(crowd, "nova").walked).toBe(0);
  expect(at(crowd, "late").at).toBe("visitor-home-0");
  expect(at(crowd, "byte").at).toBe("stand-desk-1"); // sofa-2 stayed taken, so it ended at its fallback
  expect(at(crowd, "owner").at).toBe("sofa-2");
 });
});

describe("crowd: cost (Stage 2)", () => {
 it("updates fifteen characters well inside a frame", () => {
  const crowd = createWorldIsoCrowd(G)!;
  for (let i = 0; i < 9; i++) crowd.join({ id: `p${i}`, rank: 200, at: `stand-desk-${i}` });
  for (let i = 0; i < 6; i++) crowd.join({ id: `v${i}`, rank: 100, at: `visitor-home-${i}` });
  const spots = ["sofa-1", "sofa-2", "sofa-3", "coffee-1", "coffee-2", "coffee-3", "window-1", "window-2", "board-1", "board-2", "shelf-1", "shelf-2", "plant-1", "chat-a1", "chat-a2"];
  const ids = crowd.actors().map(a => a.id);
  crowd.step(DT); // builds the navigation grid once
  let total = 0, worst = 0, frames = 0;
  for (let round = 0; round < 6; round++) {
   ids.forEach((id, i) => crowd.send(id, round % 2 ? (id.startsWith("p") ? `stand-desk-${id.slice(1)}` : `visitor-home-${id.slice(1)}`) : spots[(i + round) % spots.length]!));
   for (let i = 0; i < 600; i++) { const t0 = performance.now(); crowd.step(DT); const ms = performance.now() - t0; total += ms; worst = Math.max(worst, ms); frames++; crowd.drain(); }
  }
  const average = total / frames, stats = crowd.stats();
  console.log(`[iso-crowd] 15 characters: average ${average.toFixed(4)} ms per frame, worst ${worst.toFixed(2)} ms, ${stats.pathSearches} path searches in ${frames} frames`);
  expect(average).toBeLessThan(4); // target under 1 ms; 4 ms allows for slow CI machines
 }, 60_000);
});

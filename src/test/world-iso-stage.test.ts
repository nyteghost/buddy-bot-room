import { describe, expect, it } from "vitest";
import { AMBIENT_FORBIDDEN_WORDS } from "@/lib/world-ambient";
import { WORLD_HD_DIRECTIONS } from "@/lib/world-hd";
import { worldIsoActorBox, worldIsoDepthOrder } from "@/lib/world-iso-depth";
import { WORLD_ISO_FOOTPRINT, worldIsoPath, worldIsoPointFree } from "@/lib/world-iso-ground";
import { createWorldIsoStage, type WorldIsoStage, type WorldIsoStageFrame } from "@/lib/world-iso-stage";

const NAMES = ["Nova", "Byte", "Sage", "Pip", "Echo", "Rune", "Tux", "Saiyan", "Mimic"], IDS = ["nova", "byte", "sage", "pip", "echo", "rune", "claude", "saiyan", "mimic"];
const pals = (real: readonly string[] = []) => IDS.map((id, i) => ({ id, name: NAMES[i]!, desk: i, real: real.includes(id) }));
const visitors = (n = 6) => Array.from({ length: n }, (_, i) => ({ id: `guest-${i}`, name: `Visitor ${i + 1}` }));
const make = (options: Partial<Parameters<typeof createWorldIsoStage>[0]> = {}): WorldIsoStage => {
 const stage = createWorldIsoStage({ pals: pals(), visitors: visitors(), seed: "test", ...options });
 if (!stage.ok) throw new Error("stage did not start");
 return stage;
};
const DT = 1000 / 60, GAP = 2 * WORLD_ISO_FOOTPRINT;

describe("stage: cast and identity (Stage 2/3)", () => {
 it("places nine Pals at their own workstations and six visitors at their homes", () => {
  const frame = make().frame();
  expect(frame.actors).toHaveLength(15);
  expect(frame.actors.filter(a => a.kind === "pal").map(a => [a.key, a.id, a.name, a.desk, a.at])).toEqual(IDS.map((id, i) => [`pal:${id}`, id, NAMES[i], i, `stand-desk-${i}`]));
  expect(frame.actors.filter(a => a.kind === "visitor").map(a => a.at)).toEqual(Array.from({ length: 6 }, (_, i) => `visitor-home-${i}`));
  expect(frame.actors.every(a => a.present && !a.moving && a.frame === 0 && !a.real)).toBe(true);
 });

 it("keeps workstation numbers when the cast is partial or listed in another order", () => {
  const some = [{ id: "sage", name: "Sage", desk: 2 }, { id: "nova", name: "Nova", desk: 0 }, { id: "mimic", name: "Mimic", desk: 8 }];
  const frame = make({ pals: some, visitors: visitors(2) }).frame();
  expect(frame.actors.filter(a => a.kind === "pal").map(a => [a.id, a.desk, a.at])).toEqual([["sage", 2, "stand-desk-2"], ["nova", 0, "stand-desk-0"], ["mimic", 8, "stand-desk-8"]]);
  expect(frame.actors.filter(a => a.kind === "visitor")).toHaveLength(2);
 });

 it("ignores duplicate ids, duplicate or out-of-range desks, and more than six visitors", () => {
  const messy = [...pals(), { id: "nova", name: "Imposter", desk: 3 }, { id: "tenth", name: "Tenth", desk: 9 }, { id: "minus", name: "Minus", desk: -1 }, { id: "clash", name: "Clash", desk: 0 }];
  const frame = make({ pals: messy, visitors: visitors(9) }).frame();
  expect(frame.actors.filter(a => a.kind === "pal").map(a => a.name)).toEqual(NAMES);
  expect(frame.actors.filter(a => a.kind === "visitor")).toHaveLength(6);
  expect(make({ pals: [], visitors: [] }).frame().actors).toHaveLength(0);
 });

 it("fails safely for an invalid plan", () => {
  for (const plan of [null, {}, { id: "x", floor: [], colliders: [], anchors: [], door: "door" }, { id: "huge", floor: [{ u: 0, v: 0 }, { u: 1e6, v: 0 }, { u: 1e6, v: 1e6 }, { u: 0, v: 1e6 }], colliders: [], anchors: [], door: "door" }]) {
   const stage = createWorldIsoStage({ plan, pals: pals(), visitors: visitors() });
   expect(stage.ok).toBe(false);
   if (!stage.ok) expect(stage.problems.length).toBeGreaterThan(0);
  }
 });
});

describe("stage: honesty about real work", () => {
 it("shows a Pal as really active only when the caller says so, and sends it to its own workstation", () => {
  const stage = make({ pals: pals(["sage"]) });
  for (let i = 0; i < 60 * 240; i++) stage.advance(DT);
  let frame = stage.frame();
  const sage = frame.actors.find(a => a.id === "sage")!;
  expect(sage.real).toBe(true); expect(sage.ambient).toBeNull(); expect(sage.at).toBe("stand-desk-2");
  for (const a of frame.actors) if (a.id !== "sage") { expect(a.real).toBe(false); expect(typeof a.ambient).toBe("string"); }
  // Real work starts for Echo while it is away from its desk; visitors and unknown ids can never be "real".
  stage.setReal(["echo", "guest-1", "nobody"]);
  for (let i = 0; i < 60 * 90; i++) stage.advance(DT);
  frame = stage.frame();
  expect(frame.actors.filter(a => a.real).map(a => a.id)).toEqual(["echo"]);
  expect(frame.actors.find(a => a.id === "echo")!.at).toBe("stand-desk-4");
  stage.setReal([]);
  stage.advance(DT);
  expect(stage.frame().actors.some(a => a.real)).toBe(false);
 }, 60_000);

 it("never uses work words for ambient behaviour", () => {
  const stage = make({ seed: "words" }), seen = new Set<string>();
  for (let i = 0; i < 60 * 600; i++) { stage.advance(DT); if (i % 30 === 0) for (const a of stage.frame().actors) if (a.ambient) seen.add(a.ambient); }
  expect(seen.has("walking")).toBe(true);
  expect(seen.size).toBeGreaterThan(5);
  for (const text of seen) for (const word of AMBIENT_FORBIDDEN_WORDS) expect(text.toLowerCase().includes(word)).toBe(false);
 }, 60_000);
});

describe("stage: fifteen characters for twenty simulated minutes", () => {
 for (const [seed, extra] of [["a", {}], ["b", { pals: pals(["nova", "rune"]) }], ["c", { visitorsEnter: true }], ["d", {}], ["e", {}]] as const) {
  it(`seed ${seed}: no overlap, no clipping, no teleporting, no deadlock, eight facings, valid draw order`, () => {
   const stage = make({ seed, ...extra }), plan = stage.scene.plan;
   let minGap = Infinity, clipped = 0, maxStep = 0, cycles = 0, badOrder = 0, movingStillFrame = 0, before: WorldIsoStageFrame | null = null;
   const facings = new Set<string>(), frames = new Set<number>(), visited = new Set<string>();
   const steps = 20 * 60 * 60;
   for (let i = 0; i < steps; i++) {
    stage.advance(DT);
    const frame = stage.frame(), shown = frame.actors.filter(a => a.present);
    cycles += frame.cycles;
    if (frame.order.length !== stage.scene.props.length + shown.length || new Set(frame.order).size !== frame.order.length) badOrder++;
    for (let p = 0; p < shown.length; p++) {
     const a = shown[p]!;
     if (!worldIsoPointFree(plan, { u: a.u, v: a.v })) clipped++;
     if (a.moving) { facings.add(a.facing); frames.add(a.frame); } else if (a.frame !== 0) movingStillFrame++;
     if (a.at) visited.add(a.at);
     const was = before?.actors.find(b => b.key === a.key);
     if (was?.present) maxStep = Math.max(maxStep, Math.hypot(a.u - was.u, a.v - was.v));
     for (let q = p + 1; q < shown.length; q++) minGap = Math.min(minGap, Math.hypot(a.u - shown[q]!.u, a.v - shown[q]!.v));
    }
    before = frame;
   }
   const stats = stage.stats(), last = stage.frame();
   console.log(`[iso-stage] seed ${seed}: min gap ${minGap.toFixed(3)} tiles, longest stall ${(stats.longestStallMs / 1000).toFixed(1)} s, ${stats.pathSearches} path searches, ${stats.sideSteps} re-routes, ${stats.backOffs} back-offs, ${stats.fallbacks} fallbacks, ${stats.parked} parked`);
   expect(last.actors.filter(a => a.present)).toHaveLength(15);
   expect(clipped).toBe(0);                                        // nobody inside furniture or walls
   expect(minGap).toBeGreaterThanOrEqual(GAP - 1e-9);              // nobody overlapping
   expect(maxStep).toBeLessThanOrEqual(1.6 * DT / 1000 + 1e-9);    // nobody teleporting
   expect(stats.longestStallMs).toBeLessThan(25_000);              // nobody stuck
   expect(stats.parked).toBe(0);
   expect(cycles).toBe(0); expect(badOrder).toBe(0);               // draw order always complete and cycle-free
   expect([...facings].sort()).toEqual([...WORLD_HD_DIRECTIONS].sort()); // all eight directions walked
   expect([...frames].sort()).toEqual([0, 1, 2, 3, 4, 5]);         // the whole six-frame walk is used
   expect(movingStillFrame).toBe(0);                               // standing characters show frame 0
   expect(stats.pathSearches / 15 / 20).toBeLessThan(4);           // fewer than 4 path searches per character per minute
   expect(visited.size).toBeGreaterThan(25);                       // the room is actually used
   if (seed === "b") for (const id of ["nova", "rune"]) { const a = last.actors.find(x => x.id === id)!; expect(a.real).toBe(true); expect(a.at).toBe(`stand-desk-${IDS.indexOf(id)}`); }
  }, 120_000);
 }

 it("is deterministic: the same seed gives the same recording, a different seed does not", () => {
  const record = (seed: string) => { const stage = make({ seed }); const out: string[] = []; for (let i = 0; i < 60 * 120; i++) { stage.advance(DT); if (i % 60 === 0) out.push(JSON.stringify(stage.frame())); } return out.join("\n"); };
  const first = record("same");
  expect(record("same")).toBe(first);
  expect(record("other") === first).toBe(false);
 }, 60_000);
});

describe("stage: facing, depth and motion settings", () => {
 it("faces the direction of travel while walking and the anchor's facing on arrival", () => {
  const stage = make({ seed: "facing" }), plan = stage.scene.plan, anchors = new Map(plan.anchors.map(a => [a.id, a]));
  let arrivals = 0;
  for (let i = 0; i < 60 * 300; i++) {
   stage.advance(DT);
   for (const a of stage.frame().actors) if (a.at && !a.moving && a.status === "idle") { arrivals++; expect(a.facing).toBe(anchors.get(a.at)!.facing); expect([a.u, a.v]).toEqual([anchors.get(a.at)!.at.u, anchors.get(a.at)!.at.v]); }
  }
  expect(arrivals).toBeGreaterThan(1000);
 }, 60_000);

 it("draws a Pal standing behind a desk before that desk, and one in front of it after", () => {
  const stage = make(), props = stage.scene.depthItems;
  const where = (u: number, v: number) => { const order = worldIsoDepthOrder([...props, { id: "x", layer: "actor", box: worldIsoActorBox({ u, v }) }]).order; return order.indexOf("x") - order.indexOf("desk-1"); };
  expect(where(7.3, 1.3)).toBeLessThan(0);   // behind desk-1 (wall side)
  expect(where(7.3, 3.7)).toBeGreaterThan(0); // in front of it
  const frame = stage.frame();
  expect(frame.order.indexOf("pal:byte")).toBeLessThan(frame.order.indexOf("desk-1")); // Byte stands on the wall side of desk-1
 });

 it("paused: time does not move; reduced motion: nobody walks and everyone still reaches their spots", () => {
  const paused = make({ seed: "still" });
  for (let i = 0; i < 600; i++) paused.advance(DT);
  const frozen = JSON.stringify(paused.frame());
  for (let i = 0; i < 6000; i++) paused.advance(DT, { paused: true });
  expect(JSON.stringify(paused.frame())).toBe(frozen);

  const reduced = make({ seed: "still" }), plan = reduced.scene.plan, anchors = new Map(plan.anchors.map(a => [a.id, a]));
  let moved = 0, off = 0, minGap = Infinity; const spots = new Set<string>();
  for (let i = 0; i < 60 * 600; i++) {
   reduced.advance(DT, { reduced: true });
   const shown = reduced.frame().actors;
   for (let p = 0; p < shown.length; p++) {
    const a = shown[p]!;
    if (a.moving || a.frame !== 0) moved++;
    if (!a.at || a.u !== anchors.get(a.at)!.at.u || a.v !== anchors.get(a.at)!.at.v) off++; else spots.add(a.at);
    for (let q = p + 1; q < shown.length; q++) minGap = Math.min(minGap, Math.hypot(a.u - shown[q]!.u, a.v - shown[q]!.v));
   }
  }
  expect(moved).toBe(0); expect(off).toBe(0);
  expect(minGap).toBeGreaterThanOrEqual(GAP - 1e-9);
  expect(spots.size).toBeGreaterThan(20); // the schedule still plays out, as jumps
 }, 60_000);

 it("handles bad time steps and long gaps without teleporting", () => {
  const stage = make({ seed: "gap" });
  const start = JSON.stringify(stage.frame());
  for (const ms of [Number.NaN, -1, -Infinity]) stage.advance(ms);
  expect(JSON.stringify(stage.frame())).toBe(start);
  for (let i = 0; i < 600; i++) stage.advance(DT);
  const before = stage.frame();
  stage.advance(3_600_000); // an hour asleep counts as at most a minute, walked in small steps
  const after = stage.frame();
  expect(after.timeMs - before.timeMs).toBeLessThanOrEqual(60_000);
  for (const a of after.actors) expect(worldIsoPointFree(stage.scene.plan, { u: a.u, v: a.v })).toBe(true);
 });
});

describe("stage: cost for fifteen characters", () => {
 it("measures crowd update, depth sort and path search", () => {
  const stage = make({ seed: "cost" });
  for (let i = 0; i < 120; i++) { stage.advance(DT); stage.frame(); } // warm up: builds the grid
  let update = 0, draw = 0, worstUpdate = 0; const n = 60 * 300;
  for (let i = 0; i < n; i++) {
   let t = performance.now(); stage.advance(DT); let ms = performance.now() - t; update += ms; worstUpdate = Math.max(worstUpdate, ms);
   t = performance.now(); stage.frame(); ms = performance.now() - t; draw += ms;
  }
  const items = [...stage.scene.depthItems, ...stage.frame().actors.map(a => ({ id: a.key, layer: "actor" as const, box: worldIsoActorBox({ u: a.u, v: a.v }) }))];
  let t = performance.now(); for (let i = 0; i < 2000; i++) worldIsoDepthOrder(items); const sort = (performance.now() - t) / 2000;
  const plan = stage.scene.plan, door = plan.anchors.find(a => a.id === "door")!.at, far = plan.anchors.filter(a => a.kind === "seat" || a.kind === "board" || a.kind === "window");
  t = performance.now(); let searches = 0; for (let k = 0; k < 20; k++) for (const a of far) { worldIsoPath(plan, door, a.at); searches++; } const search = (performance.now() - t) / searches;
  console.log(`[iso-stage] 15 characters: crowd+schedule update ${(update / n).toFixed(4)} ms average (worst ${worstUpdate.toFixed(2)} ms), frame data + depth order ${(draw / n).toFixed(4)} ms average, full depth sort of ${items.length} items ${sort.toFixed(4)} ms, one path search ${search.toFixed(4)} ms`);
  expect(update / n).toBeLessThan(4);  // target under 1 ms
  expect(sort).toBeLessThan(1.5);      // target under 0.3 ms
  expect(search).toBeLessThan(5);
 }, 60_000);
});

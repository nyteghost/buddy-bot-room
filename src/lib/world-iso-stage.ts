import type { WorldHdClip, WorldHdDirection } from "./world-hd";
import { createWorldIsoCrowd, type WorldIsoCrowdStats, type WorldIsoCrowdStatus } from "./world-iso-crowd";
import { worldIsoActorBox, worldIsoDepthOrder } from "./world-iso-depth";
import { worldIsoWalkFrameIndex } from "./world-iso-gait";
import { WORLD_ISO_GREYBOX } from "./world-iso-greybox";
import type { GroundPlanProblem } from "./world-iso-ground";
import { worldIsoProjection } from "./world-iso-projection";
import { worldIsoScene, type WorldIsoScene } from "./world-iso-scene";
import { WORLD_ISO_MAX_PALS, WORLD_ISO_MAX_VISITORS, worldIsoSchedule, type WorldIsoScheduleActor } from "./world-iso-schedule";

/**
 * Living Universe — Isometric Office preview (Step 1b): the stage that ties scene, schedule and crowd together.
 *
 * A plain object with no React and no DOM, so the whole preview can be simulated and tested without a browser.
 * The preview component is a thin drawing layer over `frame()`.
 *
 * Identity: the stage is given ids, display names and workstation numbers by the caller and never changes
 * them. Workstation n is always `seat-n`, the same mapping as the flat HD office.
 * Honesty: `real` comes only from the caller (the app's own activity indicator). The stage never sets it.
 */
export type WorldIsoStagePal = Readonly<{ id: string; name: string; /** Workstation number, 0–8. */ desk: number; /** App-reported real activity. */ real?: boolean; sits?: boolean }>;
export type WorldIsoStageVisitor = Readonly<{ id: string; name: string }>;
export type WorldIsoStageActor = Readonly<{
 /** Draw id: `pal:<id>` or `visitor:<id>`. */ key: string;
 id: string; name: string; kind: "pal" | "visitor"; desk: number | null;
 present: boolean; u: number; v: number; /** World px of the feet. */ x: number; y: number;
 facing: WorldHdDirection; moving: boolean; /** Zero-based walk frame (0 when standing). */ frame: number;
 status: WorldIsoCrowdStatus; at: string | null;
 /** True only when the app reported real activity for this Pal. */ real: boolean;
 /** Ambient description ("getting a drink", "walking" …); null when `real`. */ ambient: string | null;
}>;
export type WorldIsoStageFrame = Readonly<{
 timeMs: number; actors: readonly WorldIsoStageActor[];
 /** Back-to-front draw order of prop ids and actor keys. */ order: readonly string[];
 /** Depth-sort cycles this frame (0 for a valid layout). */ cycles: number;
}>;
export type WorldIsoStageMode = Readonly<{ paused?: boolean; reduced?: boolean }>;
export type WorldIsoStage = Readonly<{
 ok: true; scene: WorldIsoScene;
 /** Move time forward. Paused: nothing changes. Reduced: no walking; characters appear at their spots. */
 advance(ms: number, mode?: WorldIsoStageMode): void;
 /** Tell the stage which Pals the app reports as really active right now. */
 setReal(ids: Iterable<string>): void;
 frame(): WorldIsoStageFrame;
 stats(): Readonly<WorldIsoCrowdStats>;
}>;
export type WorldIsoStageFailure = Readonly<{ ok: false; problems: readonly GroundPlanProblem[] }>;

/** Synthetic six-frame walk timing (the approved 6 × 120 ms cycle); used only to pick a frame number. */
const WALK: WorldHdClip = { loop: true, frames: Array.from({ length: 6 }, (_, i) => ({ src: `walk-${i}`, durationMs: 120 })) };
const RANK = { real: 300, pal: 200, visitor: 100 } as const;
const problem = (message: string): WorldIsoStageFailure => ({ ok: false, problems: [{ code: "plan-invalid", id: "stage", message }] });

export function createWorldIsoStage({ plan = WORLD_ISO_GREYBOX, pals, visitors, seed = "iso-office", visitorsEnter = false, slotMs }: {
 plan?: unknown; pals: readonly WorldIsoStagePal[]; visitors: readonly WorldIsoStageVisitor[]; seed?: string;
 /** Start visitors outside and let them walk in through the door (default: start at their homes). */ visitorsEnter?: boolean;
 slotMs?: number;
}): WorldIsoStage | WorldIsoStageFailure {
 const projection = worldIsoProjection();
 const scene = worldIsoScene(plan, projection);
 if (!scene.ok) return scene;
 const seen = new Set<string>(), desks = new Set<number>();
 const cast: { key: string; id: string; name: string; kind: "pal" | "visitor"; desk: number | null; schedule: WorldIsoScheduleActor }[] = [];
 for (const p of Array.isArray(pals) ? pals.slice(0, 64) : []) {
  if (!p || typeof p.id !== "string" || seen.has(`pal:${p.id}`) || !Number.isSafeInteger(p.desk) || p.desk < 0 || p.desk >= WORLD_ISO_MAX_PALS || desks.has(p.desk)) continue;
  seen.add(`pal:${p.id}`); desks.add(p.desk);
  cast.push({ key: `pal:${p.id}`, id: p.id, name: String(p.name ?? p.id), kind: "pal", desk: p.desk, schedule: { id: `pal:${p.id}`, kind: "pal", slot: p.desk, sits: p.sits === true } });
 }
 let home = 0;
 for (const v of Array.isArray(visitors) ? visitors.slice(0, 64) : []) {
  if (!v || typeof v.id !== "string" || seen.has(`visitor:${v.id}`) || home >= WORLD_ISO_MAX_VISITORS) continue;
  seen.add(`visitor:${v.id}`);
  cast.push({ key: `visitor:${v.id}`, id: v.id, name: String(v.name ?? v.id), kind: "visitor", desk: null, schedule: { id: `visitor:${v.id}`, kind: "visitor", slot: home++ } });
 }
 const schedule = worldIsoSchedule({ plan: scene.plan, actors: cast.map(c => c.schedule), seed, ...(slotMs !== undefined ? { slotMs } : {}) });
 const crowd = createWorldIsoCrowd(scene.plan, { projection });
 if (!schedule || !crowd) return problem("The preview could not start its schedule or crowd for this plan.");
 const members = cast.filter(c => schedule.home(c.key) !== null);
 for (const c of members) {
  const start = c.kind === "visitor" && visitorsEnter ? null : schedule.home(c.key);
  if (!crowd.join({ id: c.key, rank: c.kind === "pal" ? RANK.pal : RANK.visitor, at: start })) return problem(`Character ${c.key} could not be placed at its starting spot.`);
 }
 let real = new Set<string>(members.filter(c => c.kind === "pal" && pals.find(p => p.id === c.id)?.real === true).map(c => c.key));
 let time = 0, slot = -1, realKey = "";
 const labels = new Map<string, string | null>(), sentAt = new Map<string, string>();
 let cachedOrder: { signature: string; order: readonly string[]; cycles: number } | null = null;

 function direct() {
  const index = Math.floor(time / schedule!.slotMs), key = [...real].sort().join(",");
  const intents = schedule!.intents(time, real);
  if (index !== slot || key !== realKey) { slot = index; realKey = key; sentAt.clear(); }
  const sinceSlot = time - index * schedule!.slotMs;
  for (const intent of intents) {
   if (sentAt.get(intent.actor) === intent.anchor) continue;
   if (!intent.real && sinceSlot < intent.delayMs) continue;
   crowd!.setRank(intent.actor, intent.real ? RANK.real : intent.actor.startsWith("pal:") ? RANK.pal : RANK.visitor);
   crowd!.send(intent.actor, intent.anchor, intent.fallback);
   sentAt.set(intent.actor, intent.anchor);
   labels.set(intent.actor, intent.real ? null : intent.label);
  }
 }
 return Object.freeze({
  ok: true as const, scene,
  advance(ms: number, mode: WorldIsoStageMode = {}) {
   if (mode.paused || !Number.isFinite(ms) || ms < 0) return;
   let left = Math.min(ms, 60_000);
   do { // the crowd takes at most 250 ms per step; longer gaps are walked in several steps
    const dt = Math.min(left, 250);
    time += dt; direct(); crowd.step(dt, mode.reduced ? { reduced: true } : {});
    if (mode.reduced) crowd.step(1, { reduced: true });
    left -= dt;
   } while (left > 1e-9);
   crowd.drain();
  },
  setReal(ids: Iterable<string>) { const next = new Set<string>(); for (const id of ids) if (members.some(c => c.kind === "pal" && c.id === id)) next.add(`pal:${id}`); real = next; },
  frame(): WorldIsoStageFrame {
   const state = new Map(crowd.actors().map(a => [a.id, a]));
   const actors: WorldIsoStageActor[] = members.map(c => {
    const a = state.get(c.key)!, s = a.present ? projection.toScreen({ u: a.u, v: a.v }) : { x: Number.NaN, y: Number.NaN }, isReal = real.has(c.key);
    return Object.freeze({
     key: c.key, id: c.id, name: c.name, kind: c.kind, desk: c.desk, present: a.present, u: a.u, v: a.v, x: s.x, y: s.y, facing: a.facing, moving: a.moving,
     frame: a.moving ? worldIsoWalkFrameIndex(WALK, a.walked) : 0, status: a.status, at: a.at, real: isReal,
     ambient: isReal ? null : a.status === "outside" ? "on their way in" : a.moving || a.status === "walking" ? "walking" : labels.get(c.key) ?? (c.kind === "pal" ? "at their desk" : "resting"),
    });
   });
   const shown = actors.filter(a => a.present);
   const signature = shown.map(a => `${a.key}:${a.u.toFixed(3)},${a.v.toFixed(3)}`).join("|");
   if (!cachedOrder || cachedOrder.signature !== signature) {
    const result = worldIsoDepthOrder([...scene.depthItems, ...shown.map(a => ({ id: a.key, layer: "actor" as const, box: worldIsoActorBox({ u: a.u, v: a.v }) }))]);
    cachedOrder = { signature, order: result.order, cycles: result.cycles };
   }
   return Object.freeze({ timeMs: time, actors: Object.freeze(actors), order: cachedOrder.order, cycles: cachedOrder.cycles });
  },
  stats: () => crowd.stats(),
 });
}

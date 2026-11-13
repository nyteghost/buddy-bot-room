import type { GroundAnchor, GroundPlan } from "./world-iso-ground";
import type { GroundPoint } from "./world-iso-projection";
import { worldIsoPlanSealed } from "./world-iso-ground";
import { WORLD_ISO_GREYBOX } from "./world-iso-greybox";

/** Presentation only: no AI tasks, private data, memory, permission decisions or invented work. */
export const WORLD_ISO_PAL_IDS = ["nova", "byte", "sage", "pip", "echo", "rune", "claude", "saiyan", "mimic"] as const;
export const WORLD_ISO_SCHEDULE_PERIOD_MS = 20_000;
export type WorldIsoRealActivity = "responding" | "focus" | null;
export type WorldIsoPalInput = Readonly<{ id: string; name: string; enabled: boolean; real: WorldIsoRealActivity }>;
export type WorldIsoVisitorInput = Readonly<{ id: string; name: string }>;
export type WorldIsoScheduledActor = Readonly<{
 id: string; name: string; kind: "pal" | "visitor"; home: string;
 target: GroundPoint; facing: GroundAnchor["facing"];
 /** Only sourced from the authoritative input, never from ambient movement. */
 real: WorldIsoRealActivity;
 activity: "real" | "ambient" | "home";
}>;

const hash = (value: string): number => {
 let h = 2166136261;
 for (let i = 0; i < value.length; i++) h = Math.imul(h ^ value.charCodeAt(i), 16777619);
 return h >>> 0;
};
const position = (a: GroundAnchor): GroundPoint => ({ u: a.at.u, v: a.at.v });
const byId = (plan: GroundPlan, id: string) => plan.anchors.find(a => a.id === id);
const available = (plan: GroundPlan) => plan.anchors.filter(a =>
 a.kind === "chat" || a.kind === "window" || a.kind === "coffee" || a.kind === "sofa" || a.kind === "board");

/** Never derive a Pal's desk from enabled state or position in the incoming array. */
export function worldIsoPalSeatId(palId: string): string | null {
 const index = (WORLD_ISO_PAL_IDS as readonly string[]).indexOf(palId);
 return index < 0 ? null : "seat-" + index;
}

/**
 * Stable, unique destination reservations by anchor id. The algorithm processes
 * canonical Pal order, then sorted visitors; no two ambient actors are assigned
 * the same shared anchor in one period. A busy social area falls back to the
 * actor's own home. Real work always selects the original workstation.
 */
export function worldIsoSchedule(
 pals: readonly WorldIsoPalInput[], visitors: readonly WorldIsoVisitorInput[],
 elapsedMs: number, plan: GroundPlan = WORLD_ISO_GREYBOX,
): WorldIsoScheduledActor[] {
 if (!worldIsoPlanSealed(plan) || !Number.isFinite(elapsedMs)) return [];
 const period = Math.max(0, Math.floor(elapsedMs / WORLD_ISO_SCHEDULE_PERIOD_MS));
 const common = available(plan);
 const occupied = new Set<string>();
 const out: WorldIsoScheduledActor[] = [];
 const choose = (id: string, home: GroundAnchor, real: WorldIsoRealActivity) => {
  if (!real && period % 3 !== 0 && common.length) {
   const first = hash(id + ":" + period) % common.length;
   for (let step = 0; step < common.length; step++) {
    const candidate = common[(first + step) % common.length]!;
    if (!occupied.has(candidate.id)) { occupied.add(candidate.id); return candidate; }
   }
  }
  occupied.add(home.id);
  return home;
 };
 const uniquePals = new Map<string, WorldIsoPalInput>();
 for (const p of pals) if (p.enabled && worldIsoPalSeatId(p.id) && !uniquePals.has(p.id)) uniquePals.set(p.id, p);
 // Reserve all real seats first, preventing any other actor's social choice from
 // displacing a real-working Pal. Seats are not in the ambient candidate pool.
 for (const id of WORLD_ISO_PAL_IDS) {
  const p = uniquePals.get(id);
  if (!p) continue;
  const seatId = worldIsoPalSeatId(id)!;
  const home = byId(plan, seatId);
  if (!home || home.kind !== "seat") continue;
  const real = p.real === "focus" || p.real === "responding" ? p.real : null;
  const target = choose("pal:" + id, home, real);
  out.push({ id: "pal:" + id, name: p.name, kind: "pal", home: home.id,
   target: position(target), facing: target.facing, real,
   activity: real ? "real" : target.id === home.id ? "home" : "ambient" });
 }
 const homes = plan.anchors.filter(a => a.kind === "visitor").sort((a, b) => a.id.localeCompare(b.id));
 const uniqueVisitors = [...new Map(visitors.map(v => [v.id, v])).values()]
  .sort((a, b) => a.id.localeCompare(b.id)).slice(0, 6);
 for (let i = 0; i < uniqueVisitors.length; i++) {
  const visitor = uniqueVisitors[i]!, home = homes[i];
  if (!home) break;
  const target = choose("custom:" + visitor.id, home, null);
  out.push({ id: "custom:" + visitor.id, name: visitor.name, kind: "visitor", home: home.id,
   target: position(target), facing: target.facing, real: null,
   activity: target.id === home.id ? "home" : "ambient" });
 }
 return out;
}

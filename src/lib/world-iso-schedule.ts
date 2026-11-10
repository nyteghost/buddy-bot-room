import type { GroundAnchor, GroundPlan } from "./world-iso-ground";
import type { GroundPoint } from "./world-iso-projection";
import { worldIsoPlanSealed } from "./world-iso-ground";
import { WORLD_ISO_GREYBOX } from "./world-iso-greybox";

/**
 * Isometric ambient schedule. Presentation ONLY: no agent jobs, memory access, permission
 * checks or invented work. The current app owns real activity; callers pass it in.
 */
export const WORLD_ISO_PAL_IDS = ["nova", "byte", "sage", "pip", "echo", "rune", "claude", "saiyan", "mimic"] as const;
export type WorldIsoRealActivity = "responding" | "focus" | null;
export type WorldIsoPalInput = Readonly<{ id: string; name: string; enabled: boolean; real: WorldIsoRealActivity }>;
export type WorldIsoVisitorInput = Readonly<{ id: string; name: string }>;
export type WorldIsoScheduledActor = Readonly<{
 id: string;
 name: string;
 kind: "pal" | "visitor";
 home: string;
 target: GroundPoint;
 facing: GroundAnchor["facing"];
 /** Only sourced from the authoritative input, not ambient movement. */
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
const available = (plan: GroundPlan) => plan.anchors.filter(a => a.kind === "chat" || a.kind === "window" || a.kind === "coffee" || a.kind === "sofa" || a.kind === "board");
const period = 20_000;

/** Stable desk mapping: never infer a Pal's desk from enabled/visitor array order. */
export function worldIsoPalSeatId(palId: string): string | null {
 const index = (WORLD_ISO_PAL_IDS as readonly string[]).indexOf(palId);
 return index < 0 ? null : `seat-${index}`;
}

/**
 * Generate the same plan given the same inputs and elapsed time; no Date.now or Math.random.
 * Ambient destinations describe visual behavior only. Real activity always returns home seat.
 * Invalid/unsealed plans return nothing rather than creating unverified positions.
 */
export function worldIsoSchedule(
 pals: readonly WorldIsoPalInput[],
 visitors: readonly WorldIsoVisitorInput[],
 elapsedMs: number,
 plan: GroundPlan = WORLD_ISO_GREYBOX,
): WorldIsoScheduledActor[] {
 if (!worldIsoPlanSealed(plan) || !Number.isFinite(elapsedMs)) return [];
 const at = Math.max(0, Math.floor(elapsedMs / period));
 const common = available(plan);
 const out: WorldIsoScheduledActor[] = [];
 const seen = new Set<string>();
 for (const pal of pals) {
  if (!pal.enabled || seen.has(pal.id)) continue;
  seen.add(pal.id);
  const home = worldIsoPalSeatId(pal.id);
  const anchor = home ? byId(plan, home) : null;
  if (!anchor || anchor.kind !== "seat") continue;
  const real = pal.real === "focus" || pal.real === "responding" ? pal.real : null;
  const ambient = !real && at % 3 !== 0 && common.length ? common[hash(pal.id + ":" + at) % common.length] : null;
  const target = ambient ?? anchor;
  out.push({ id: "pal:" + pal.id, name: pal.name, kind: "pal", home: anchor.id,
   target: position(target), facing: target.facing, real, activity: real ? "real" : ambient ? "ambient" : "home" });
 }
 // Canonical sorted order, independent of the order the visitor picker sent.
 const homes = plan.anchors.filter(a => a.kind === "visitor").sort((a, b) => a.id.localeCompare(b.id));
 const uniqueVisitors = [...new Map(visitors.map(v => [v.id, v])).values()].sort((a, b) => a.id.localeCompare(b.id)).slice(0, 6);
 for (let i = 0; i < uniqueVisitors.length; i++) {
  const visitor = uniqueVisitors[i]!, anchor = homes[i];
  if (!anchor) break;
  const ambient = at % 3 !== 0 && common.length ? common[hash(visitor.id + ":" + at) % common.length] : null;
  const target = ambient ?? anchor;
  out.push({ id: "custom:" + visitor.id, name: visitor.name, kind: "visitor", home: anchor.id,
   target: position(target), facing: target.facing, real: null, activity: ambient ? "ambient" : "home" });
 }
 return out;
}

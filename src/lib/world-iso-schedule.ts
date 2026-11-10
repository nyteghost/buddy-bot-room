import { ambientDescription, type AmbientActivity } from "./world-ambient";
import type { GroundAnchor, GroundAnchorKind, GroundPlan } from "./world-iso-ground";
import { worldIsoPlanSealed } from "./world-iso-ground";

/**
 * Living Universe — Isometric Office preview (Step 1b, Stage 2): where each character wants to be.
 *
 * A deterministic ambient schedule over a sealed plan's anchors. Time is cut into slots; in each slot every
 * character gets one anchor, and no anchor is given to two characters. The same plan, actors, seed and time
 * always give the same answer, so a room reopened later continues where it would have been.
 *
 * HONESTY RULE. This module never decides that a Pal is working. The caller passes the ids of Pals the app
 * itself reports as really active (the existing activity indicator). Those Pals are sent to their own
 * workstation with `real: true` and NO label: the caller shows the app's own wording. Everyone else gets an
 * ambient activity with `real: false` and a label from the existing `ambientDescription` (which never uses
 * work words). Being at a desk without real activity is labelled "at their desk", never as work.
 */
export type WorldIsoScheduleActor = Readonly<{
 id: string; kind: "pal" | "visitor";
 /** Pals: workstation index (Pal order). Visitors: visitor-home index. */ slot: number;
 /** True when the character has sitting art; otherwise it stands at the seat's standing fallback. */ sits?: boolean;
}>;
export type WorldIsoIntent = Readonly<{
 actor: string;
 /** Anchor to go to. */ anchor: string;
 /** Anchor to use if the first cannot be reached (the character's own home). */ fallback: string;
 /** True only for Pals the caller reported as really active. */ real: boolean;
 /** Ambient activity; null when `real`. */ activity: AmbientActivity | null;
 /** Ambient description; null when `real` (the caller shows the app's own real-activity text). */ label: string | null;
 /** Chat partner's actor id, if any. */ partner: string | null;
 /** Wait this long after the slot starts before setting off, so the room does not move in lockstep. */ delayMs: number;
}>;
export type WorldIsoSchedule = Readonly<{
 slotMs: number;
 actors: readonly WorldIsoScheduleActor[];
 /** Home anchor of an actor (seat or standing fallback for Pals, visitor home for visitors); null if the plan has none. */
 home(actorId: string): string | null;
 /** Intents for the slot containing `timeMs`. `realIds` = Pals the app reports as really active. */
 intents(timeMs: number, realIds?: ReadonlySet<string>): readonly WorldIsoIntent[];
}>;
export const WORLD_ISO_SLOT_MS = 45_000;
export const WORLD_ISO_MAX_PALS = 9;
export const WORLD_ISO_MAX_VISITORS = 6;

function random(seed: string) {
 let h = 1779033703 ^ seed.length;
 for (let i = 0; i < seed.length; i++) { h = Math.imul(h ^ seed.charCodeAt(i), 3432918353); h = (h << 13) | (h >>> 19); }
 let a = h >>> 0;
 return () => { a = (a + 0x6d2b79f5) >>> 0; let t = a; t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
}
type Choice = Readonly<{ activity: AmbientActivity; kind: GroundAnchorKind | "home"; weight: number }>;
const PAL_CHOICES: readonly Choice[] = [
 { activity: "desk", kind: "home", weight: 45 }, { activity: "chat", kind: "chat", weight: 12 }, { activity: "coffee", kind: "coffee", weight: 10 },
 { activity: "relax", kind: "sofa", weight: 10 }, { activity: "window", kind: "window", weight: 8 }, { activity: "board", kind: "board", weight: 7 },
 { activity: "shelf", kind: "shelf", weight: 5 }, { activity: "plant", kind: "plant", weight: 3 },
];
const VISITOR_CHOICES: readonly Choice[] = [
 { activity: "rest", kind: "home", weight: 40 }, { activity: "relax", kind: "sofa", weight: 15 }, { activity: "coffee", kind: "coffee", weight: 12 },
 { activity: "window", kind: "window", weight: 10 }, { activity: "chat", kind: "chat", weight: 10 }, { activity: "shelf", kind: "shelf", weight: 8 }, { activity: "plant", kind: "plant", weight: 5 },
];
function pick(rand: () => number, choices: readonly Choice[]): Choice {
 let roll = rand() * choices.reduce((s, c) => s + c.weight, 0);
 for (const c of choices) { roll -= c.weight; if (roll < 0) return c; }
 return choices[0]!;
}

/**
 * Build a schedule. Returns null for an unsealed plan. Actors beyond nine Pals or six visitors, actors with
 * a duplicate id, and actors whose home anchor is missing from the plan are left out (they get no intent).
 */
export function worldIsoSchedule({ plan, actors, seed = "iso-office", slotMs = WORLD_ISO_SLOT_MS }: {
 plan: GroundPlan; actors: readonly WorldIsoScheduleActor[]; seed?: string; slotMs?: number;
}): WorldIsoSchedule | null {
 if (!worldIsoPlanSealed(plan) || !Array.isArray(actors)) return null;
 const slot = Number.isFinite(slotMs) && slotMs >= 1000 ? slotMs : WORLD_ISO_SLOT_MS;
 const byId = new Map<string, GroundAnchor>(plan.anchors.map(a => [a.id, a]));
 const homes = new Map<string, string>(), kept: WorldIsoScheduleActor[] = [];
 let pals = 0, visitors = 0;
 for (const a of actors) {
  if (!a || typeof a.id !== "string" || homes.has(a.id) || !Number.isSafeInteger(a.slot) || a.slot < 0) continue;
  let home: string | undefined;
  if (a.kind === "pal") {
   if (pals >= WORLD_ISO_MAX_PALS) continue;
   const seat = byId.get(`seat-${a.slot}`);
   home = seat ? (a.sits ? seat.id : seat.standFallback) : undefined;
  } else if (a.kind === "visitor") {
   if (visitors >= WORLD_ISO_MAX_VISITORS) continue;
   home = `visitor-home-${a.slot}`;
  } else continue;
  if (!home || !byId.has(home) || [...homes.values()].includes(home)) continue;
  homes.set(a.id, home); kept.push(a);
  if (a.kind === "pal") pals++; else visitors++;
 }
 const ofKind = (kind: GroundAnchorKind) => plan.anchors.filter(a => a.kind === kind).map(a => a.id);
 // Chat anchors come in pairs: chat-a1 / chat-a2 …
 const chatPairs: [string, string][] = [];
 for (const id of ofKind("chat")) if (id.endsWith("1") && byId.has(id.slice(0, -1) + "2")) chatPairs.push([id, id.slice(0, -1) + "2"]);
 const cache = new Map<string, readonly WorldIsoIntent[]>();

 const intents = (timeMs: number, realIds: ReadonlySet<string> = new Set()): readonly WorldIsoIntent[] => {
  const index = Number.isFinite(timeMs) ? Math.max(0, Math.floor(timeMs / slot)) : 0;
  const real = kept.filter(a => a.kind === "pal" && realIds.has(a.id)).map(a => a.id);
  const key = `${index}|${real.join(",")}`;
  const hit = cache.get(key);
  if (hit) return hit;
  const taken = new Set<string>(homes.values()); // a home is only ever used by its owner
  const out = new Map<string, WorldIsoIntent>();
  const rolls = new Map<string, { choice: Choice; rand: () => number }>();
  const goHome = (a: WorldIsoScheduleActor, rand: () => number): WorldIsoIntent => {
   const home = homes.get(a.id)!, activity: AmbientActivity = a.kind === "pal" ? "desk" : "rest";
   return { actor: a.id, anchor: home, fallback: home, real: false, activity, label: ambientDescription(activity), partner: null, delayMs: Math.round(rand() * 8000) };
  };
  for (const a of kept) {
   const home = homes.get(a.id)!;
   if (real.includes(a.id)) { out.set(a.id, { actor: a.id, anchor: home, fallback: home, real: true, activity: null, label: null, partner: null, delayMs: 0 }); continue; }
   const rand = random(`${seed}|${a.id}|${index}`);
   rolls.set(a.id, { choice: pick(rand, a.kind === "pal" ? PAL_CHOICES : VISITOR_CHOICES), rand });
  }
  // Chats first: partners are paired in actor order and take a whole pair of anchors.
  const chatters = kept.filter(a => rolls.get(a.id)?.choice.kind === "chat");
  let pair = Math.floor(random(`${seed}|chat|${index}`)() * Math.max(1, chatPairs.length));
  for (let i = 0; i + 1 < chatters.length && i / 2 < chatPairs.length; i += 2) {
   const [one, two] = chatPairs[pair++ % chatPairs.length]!, a = chatters[i]!, b = chatters[i + 1]!;
   if (taken.has(one) || taken.has(two)) continue;
   taken.add(one); taken.add(two);
   const delay = Math.round(rolls.get(a.id)!.rand() * 8000);
   out.set(a.id, { actor: a.id, anchor: one, fallback: homes.get(a.id)!, real: false, activity: "chat", label: ambientDescription("chat"), partner: b.id, delayMs: delay });
   out.set(b.id, { actor: b.id, anchor: two, fallback: homes.get(b.id)!, real: false, activity: "chat", label: ambientDescription("chat"), partner: a.id, delayMs: delay });
  }
  for (const a of kept) {
   if (out.has(a.id)) continue;
   const { choice, rand } = rolls.get(a.id)!;
   if (choice.kind === "home" || choice.kind === "chat") { out.set(a.id, goHome(a, rand)); continue; }
   const options = ofKind(choice.kind), start = Math.floor(rand() * Math.max(1, options.length));
   let anchor: string | null = null;
   for (let k = 0; k < options.length; k++) { const id = options[(start + k) % options.length]!; if (!taken.has(id)) { anchor = id; break; } }
   if (!anchor) { out.set(a.id, goHome(a, rand)); continue; }
   taken.add(anchor);
   out.set(a.id, { actor: a.id, anchor, fallback: homes.get(a.id)!, real: false, activity: choice.activity, label: ambientDescription(choice.activity), partner: null, delayMs: Math.round(rand() * 8000) });
  }
  const list = Object.freeze(kept.map(a => Object.freeze(out.get(a.id)!)));
  if (cache.size > 16) cache.delete(cache.keys().next().value as string);
  cache.set(key, list);
  return list;
 };
 return Object.freeze({ slotMs: slot, actors: Object.freeze([...kept]), home: (id: string) => homes.get(id) ?? null, intents });
}

import { describe, expect, it } from "vitest";
import { AMBIENT_FORBIDDEN_WORDS } from "@/lib/world-ambient";
import { WORLD_ISO_GREYBOX } from "@/lib/world-iso-greybox";
import type { GroundPlan } from "@/lib/world-iso-ground";
import { WORLD_ISO_SLOT_MS, worldIsoSchedule, type WorldIsoScheduleActor } from "@/lib/world-iso-schedule";

const pals: WorldIsoScheduleActor[] = Array.from({ length: 9 }, (_, i) => ({ id: `pal:${i}`, kind: "pal", slot: i }));
const visitors: WorldIsoScheduleActor[] = Array.from({ length: 6 }, (_, i) => ({ id: `visitor:${i}`, kind: "visitor", slot: i }));
const cast = [...pals, ...visitors];
const make = (seed = "test", actors = cast) => worldIsoSchedule({ plan: WORLD_ISO_GREYBOX, actors, seed })!;
const anchorIds = new Set(WORLD_ISO_GREYBOX.anchors.map(a => a.id));

describe("ambient schedule (Stage 2)", () => {
 it("gives all nine Pals and six visitors exactly one valid anchor in every slot", () => {
  const s = make();
  expect(s.actors).toHaveLength(15);
  for (let k = 0; k < 200; k++) {
   const intents = s.intents(k * WORLD_ISO_SLOT_MS + 1);
   expect(intents.map(i => i.actor)).toEqual(cast.map(a => a.id));
   for (const i of intents) { expect(anchorIds.has(i.anchor)).toBe(true); expect(i.fallback).toBe(s.home(i.actor)); }
  }
 });

 it("never sends two characters to the same anchor, and nobody to someone else's home", () => {
  for (const seed of ["a", "b", "c"]) {
   const s = make(seed), homes = new Map(cast.map(a => [s.home(a.id)!, a.id]));
   for (let k = 0; k < 300; k++) {
    const intents = s.intents(k * WORLD_ISO_SLOT_MS);
    expect(new Set(intents.map(i => i.anchor)).size).toBe(intents.length);
    for (const i of intents) { const owner = homes.get(i.anchor); if (owner) expect(owner).toBe(i.actor); }
   }
  }
 });

 it("keeps every Pal on its own workstation number and every visitor on its own home", () => {
  const s = make();
  pals.forEach((p, i) => expect(s.home(p.id)).toBe(`stand-desk-${i}`)); // no sitting art yet: the seat's standing fallback
  visitors.forEach((v, i) => expect(s.home(v.id)).toBe(`visitor-home-${i}`));
  const sitting = worldIsoSchedule({ plan: WORLD_ISO_GREYBOX, actors: pals.map(p => ({ ...p, sits: true })) })!;
  pals.forEach((p, i) => expect(sitting.home(p.id)).toBe(`seat-${i}`));
 });

 it("marks real work only for Pals the caller reports, sends them to their own workstation, and gives them no invented label", () => {
  const s = make(), real = new Set(["pal:0", "pal:4", "visitor:2", "nobody"]);
  for (let k = 0; k < 100; k++) {
   const intents = s.intents(k * WORLD_ISO_SLOT_MS, real);
   for (const i of intents) {
    const isReal = i.actor === "pal:0" || i.actor === "pal:4"; // a visitor or an unknown id is never "real"
    expect(i.real).toBe(isReal);
    if (isReal) { expect(i.anchor).toBe(s.home(i.actor)); expect(i.label).toBeNull(); expect(i.activity).toBeNull(); expect(i.delayMs).toBe(0); }
    else { expect(typeof i.label).toBe("string"); expect(i.activity === null).toBe(false); }
   }
  }
  for (let k = 0; k < 100; k++) for (const i of s.intents(k * WORLD_ISO_SLOT_MS)) expect(i.real).toBe(false); // nobody reported: nobody is real
 });

 it("never describes ambient behaviour with work words", () => {
  const s = make("words"), seen = new Set<string>();
  for (let k = 0; k < 400; k++) for (const i of s.intents(k * WORLD_ISO_SLOT_MS)) if (i.label) seen.add(i.label);
  expect(seen.size).toBeGreaterThan(5);
  for (const label of seen) for (const word of AMBIENT_FORBIDDEN_WORDS) expect(label.toLowerCase().includes(word)).toBe(false);
  expect(seen.has("at their desk")).toBe(true);
 });

 it("pairs chat partners on one pair of anchors, each naming the other", () => {
  const s = make("chatty");
  let chats = 0;
  for (let k = 0; k < 300; k++) {
   const intents = s.intents(k * WORLD_ISO_SLOT_MS), by = new Map(intents.map(i => [i.actor, i]));
   for (const i of intents) if (i.activity === "chat") {
    chats++;
    const other = by.get(i.partner!)!;
    expect(other.partner).toBe(i.actor);
    expect(other.anchor.slice(0, -1)).toBe(i.anchor.slice(0, -1));
    expect(other.anchor === i.anchor).toBe(false);
   }
  }
  expect(chats).toBeGreaterThan(10);
 });

 it("uses the social spots as well as desks, for Pals and visitors alike", () => {
  const s = make("variety"), kinds = new Map(WORLD_ISO_GREYBOX.anchors.map(a => [a.id, a.kind])), used = { pal: new Set<string>(), visitor: new Set<string>() };
  for (let k = 0; k < 300; k++) for (const i of s.intents(k * WORLD_ISO_SLOT_MS)) used[i.actor.startsWith("pal") ? "pal" : "visitor"].add(kinds.get(i.anchor)!);
  for (const kind of ["stand", "coffee", "sofa", "window", "board", "chat"]) expect(used.pal.has(kind)).toBe(true);
  for (const kind of ["visitor", "coffee", "sofa", "window", "chat"]) expect(used.visitor.has(kind)).toBe(true);
 });

 it("is deterministic for a seed and time, and different seeds differ", () => {
  const at = (seed: string, t: number) => JSON.stringify(make(seed).intents(t));
  expect(at("x", 7 * WORLD_ISO_SLOT_MS + 5)).toBe(at("x", 7 * WORLD_ISO_SLOT_MS + 5));
  expect(at("x", 7 * WORLD_ISO_SLOT_MS)).toBe(at("x", 8 * WORLD_ISO_SLOT_MS - 1)); // constant within a slot
  expect(at("x", 3 * WORLD_ISO_SLOT_MS) === at("y", 3 * WORLD_ISO_SLOT_MS)).toBe(false);
  const s = make("x");
  expect(JSON.stringify(s.intents(Number.NaN))).toBe(JSON.stringify(s.intents(0)));
  expect(JSON.stringify(s.intents(-5))).toBe(JSON.stringify(s.intents(0)));
 });

 it("caps the cast at nine Pals and six visitors and ignores bad entries", () => {
  const extra: WorldIsoScheduleActor[] = [...cast, { id: "pal:9", kind: "pal", slot: 9 }, { id: "pal:dup-desk", kind: "pal", slot: 0 }, { id: "pal:0", kind: "pal", slot: 1 },
   { id: "visitor:6", kind: "visitor", slot: 6 }, { id: "visitor:x", kind: "visitor", slot: -1 }, { id: "ghost", kind: "ghost" as "pal", slot: 0 }];
  const s = make("cap", extra);
  expect(s.actors.map(a => a.id)).toEqual(cast.map(a => a.id));
  expect(s.home("pal:9")).toBeNull();
 });

 it("refuses an unsealed plan", () => {
  expect(worldIsoSchedule({ plan: JSON.parse(JSON.stringify(WORLD_ISO_GREYBOX)) as GroundPlan, actors: cast })).toBeNull();
  expect(worldIsoSchedule({ plan: null as unknown as GroundPlan, actors: cast })).toBeNull();
 });
});

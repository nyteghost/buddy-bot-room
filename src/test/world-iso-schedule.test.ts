import { describe, expect, it } from "vitest";
import { WORLD_ISO_GREYBOX } from "@/lib/world-iso-greybox";
import { worldIsoPalSeatId, worldIsoSchedule, WORLD_ISO_PAL_IDS } from "@/lib/world-iso-schedule";

const pals = WORLD_ISO_PAL_IDS.map(id => ({ id, name: id, enabled: true, real: null }));
const guests = Array.from({ length: 6 }, (_, i) => ({ id: "visitor-" + i, name: "Guest " + i }));

describe("Step 1b authoritative-isolated ambient schedules", () => {
 it("preserves all nine stable desk IDs irrespective of Pal order", () => {
  const s = worldIsoSchedule([...pals].reverse(), guests, 0);
  expect(s).toHaveLength(15);
  for (const pal of pals) {
   const a = s.find(x => x.id === "pal:" + pal.id)!;
   expect(a.home).toBe(worldIsoPalSeatId(pal.id));
   expect(a.activity).toBe("home");
   expect(a.real).toBeNull();
  }
  expect(worldIsoPalSeatId("not-a-pal")).toBeNull();
 });
 it("keeps six distinct visitor homes, independent of incoming visitor order", () => {
  const a = worldIsoSchedule(pals, guests, 0).filter(x => x.kind === "visitor");
  const b = worldIsoSchedule(pals, [...guests].reverse(), 0).filter(x => x.kind === "visitor");
  expect(a).toEqual(b);
  expect(new Set(a.map(x => x.home)).size).toBe(6);
  const moving = worldIsoSchedule(pals, guests, 25_000);
  const shared = moving.filter(x => x.activity === "ambient").map(x => x.target.u + "," + x.target.v);
  expect(new Set(shared).size).toBe(shared.length);
 });
 it("only reports real work when the app explicitly supplied it", () => {
  const realPals = pals.map(p => p.id === "nova" ? { ...p, real: "responding" as const } : p);
  const scene = worldIsoSchedule(realPals, guests, 80_000);
  expect(scene.find(x => x.id === "pal:nova")?.activity).toBe("real");
  expect(scene.find(x => x.id === "pal:nova")?.real).toBe("responding");
  expect(scene.filter(x => x.activity === "real")).toHaveLength(1);
  expect(scene.filter(x => x.kind === "visitor").every(x => x.real === null)).toBe(true);
 });
 it("generates deterministic ambient choices from a sealed plan only", () => {
  expect(worldIsoSchedule(pals, guests, 25_000)).toEqual(worldIsoSchedule(pals, guests, 25_000));
  expect(worldIsoSchedule(pals, guests, NaN)).toEqual([]);
  expect(worldIsoSchedule(pals, guests, 0, { ...WORLD_ISO_GREYBOX })).toEqual([]);
 });
});

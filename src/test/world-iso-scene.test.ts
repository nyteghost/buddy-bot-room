import { describe, expect, it } from "vitest";
import { WORLD_ISO_GREYBOX } from "@/lib/world-iso-greybox";
import { worldIsoSceneFrame } from "@/lib/world-iso-scene";
import { worldIsoPalSeatId, WORLD_ISO_PAL_IDS } from "@/lib/world-iso-schedule";

describe("Step 1b synthetic scene", () => {
 it("draws a 2:1 diamond floor, nine desk props and no production image data", () => {
  const scene = worldIsoSceneFrame()!;
  expect(scene).not.toBeNull();
  expect(scene.floor).toHaveLength(4);
  expect(scene.grid.length).toBeGreaterThan(30);
  expect(scene.props.filter(p => p.id.startsWith("desk-"))).toHaveLength(9);
  expect(scene.order.cycles).toBe(0);
  expect(scene.order.overLimit).toBe(false);
  expect(scene.width).toBe(2752);
  expect(JSON.stringify(scene)).not.toContain("data:image");
 });
 it("keeps the character behind its front desk according to the depth sort", () => {
  for (const id of WORLD_ISO_PAL_IDS) {
   const seat = WORLD_ISO_GREYBOX.anchors.find(a => a.id === worldIsoPalSeatId(id))!;
   const scene = worldIsoSceneFrame(WORLD_ISO_GREYBOX, [{
    id: "pal:" + id, name: id, at: seat.at, kind: "pal", facing: seat.facing, real: null, walking: false,
   }])!;
   expect(scene).not.toBeNull();
   expect(scene.order.order.indexOf("pal:" + id)).toBeLessThan(scene.order.order.indexOf("prop:" + seat.front));
  }
 });
 it("refuses invalid plans, duplicate actors and positions inside furniture", () => {
  expect(worldIsoSceneFrame({ ...WORLD_ISO_GREYBOX })).toBeNull();
  const p = { id: "pal:nova", name: "Nova", at: { u: 2, v: 2 }, facing: "s" as const, kind: "pal" as const, walking: false, real: null };
  expect(worldIsoSceneFrame(WORLD_ISO_GREYBOX, [p, p])).toBeNull();
  expect(worldIsoSceneFrame(WORLD_ISO_GREYBOX, [{ ...p, at: { u: 4, v: 2.5 } }])).toBeNull();
 });
});

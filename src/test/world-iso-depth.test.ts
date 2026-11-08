import { describe, expect, it } from "vitest";
import { WORLD_ISO_MAX_PROP_TILES, worldIsoActorBox, worldIsoBehind, worldIsoDepthOrder, worldIsoSliceBox, type WorldIsoDepthItem } from "@/lib/world-iso-depth";

const prop = (id: string, u1: number, v1: number, u2: number, v2: number): WorldIsoDepthItem => ({ id, layer: "prop", box: { u1, v1, u2, v2 } });
const actor = (id: string, u: number, v: number): WorldIsoDepthItem => ({ id, layer: "actor", box: worldIsoActorBox({ u, v }) });
const before = (order: readonly string[], a: string, b: string) => order.indexOf(a) < order.indexOf(b);

describe("ground-box depth rule", () => {
 it("draws a box behind another when it ends before the other starts on either axis", () => {
  expect(worldIsoBehind({ u1: 0, v1: 0, u2: 1, v2: 1 }, { u1: 1, v1: 0, u2: 2, v2: 1 })).toBe(true);
  expect(worldIsoBehind({ u1: 0, v1: 0, u2: 1, v2: 1 }, { u1: 0, v1: 2, u2: 1, v2: 3 })).toBe(true);
  expect(worldIsoBehind({ u1: 1, v1: 0, u2: 2, v2: 1 }, { u1: 0, v1: 0, u2: 1, v2: 1 })).toBe(false);
 });

 it("keeps a character beside the FAR end of a long desk behind it (feet-height sorting gets this wrong)", () => {
  // Desk along u from 0 to 6; the character stands just behind its far end, but lower on screen than the desk's near end.
  const desk = prop("desk", 0, 2, 6, 3), pal = actor("pal", 5.5, 1.6);
  const { order } = worldIsoDepthOrder([pal, desk]);
  expect(order).toEqual(["pal", "desk"]);
 });

 it("draws a character in front of the desk when standing on its near side", () => {
  expect(worldIsoDepthOrder([prop("desk", 0, 2, 2, 3), actor("pal", 1, 3.5)]).order).toEqual(["desk", "pal"]);
 });

 it("seats a character between the chair behind and the desk in front", () => {
  const chair = prop("chair", 3.7, 0.9, 4.3, 1.2), desk = prop("desk", 3, 2, 5, 3), pal = actor("pal", 4, 1.3);
  const { order } = worldIsoDepthOrder([desk, pal, chair]);
  expect(order).toEqual(["chair", "pal", "desk"]);
 });

 it("passes behind and in front of a tall shelf", () => {
  const shelf = prop("shelf", 12, 6, 13, 6.5);
  expect(worldIsoDepthOrder([shelf, actor("behind", 12.5, 5.6)]).order).toEqual(["behind", "shelf"]);
  expect(worldIsoDepthOrder([shelf, actor("front", 12.5, 6.9)]).order).toEqual(["shelf", "front"]);
 });

 it("puts decals first and overhangs last regardless of position", () => {
  const items: WorldIsoDepthItem[] = [
   { id: "lamp", layer: "overhang", box: { u1: 0, v1: 0, u2: 0.5, v2: 0.5 } },
   actor("pal", 9, 9),
   { id: "rug", layer: "decal", box: { u1: 5, v1: 5, u2: 12, v2: 12 } },
   prop("sofa", 7, 8.6, 10, 9.6),
  ];
  const { order } = worldIsoDepthOrder(items);
  expect(order[0]).toBe("rug");
  expect(order.at(-1)).toBe("lamp");
 });

 it("gives the same order for any input order (stable, deterministic)", () => {
  const items = [prop("desk-a", 3, 2, 5, 3), prop("desk-b", 6.3, 2, 8.3, 3), actor("a", 4, 1.3), actor("b", 7.3, 1.3), actor("c", 5.6, 4), prop("shelf", 12, 6, 13, 6.5), actor("d", 12.5, 7)];
  const reference = worldIsoDepthOrder(items).order;
  let seed = 7;
  const rand = () => (seed = (seed * 1103515245 + 12345) % 2147483648) / 2147483648;
  for (let k = 0; k < 25; k++) {
   const shuffled = [...items].sort(() => rand() - 0.5);
   expect(worldIsoDepthOrder(shuffled).order).toEqual(reference);
  }
 });

 it("never needs the cycle fallback for the grey-box style layouts", () => {
  const items: WorldIsoDepthItem[] = [];
  for (let i = 0; i < 9; i++) items.push(prop(`desk-${i}`, (i % 3) * 3.3 + 3, Math.floor(i / 3) * 3 + 2, (i % 3) * 3.3 + 5, Math.floor(i / 3) * 3 + 3));
  for (let i = 0; i < 15; i++) items.push(actor(`actor-${i}`, 0.7 + (i * 1.17) % 17, 0.9 + (i * 2.31) % 12));
  expect(worldIsoDepthOrder(items).cycles).toBe(0);
 });

 it("rejects duplicate ids", () => {
  let threw = false;
  try { worldIsoDepthOrder([actor("x", 1, 1), actor("x", 2, 2)]); } catch { threw = true; }
  expect(threw).toBe(true);
 });
});

describe("slicing long props", () => {
 it("splits a prop longer than three tiles into equal slices along its long axis", () => {
  const slices = worldIsoSliceBox({ id: "bench", u1: 0, v1: 0, u2: 7, v2: 1 });
  expect(slices.map(s => s.id)).toEqual(["bench#0", "bench#1", "bench#2"]);
  expect(slices[0]!.u1).toBe(0); expect(slices[2]!.u2).toBe(7);
  for (const s of slices) expect(s.u2 - s.u1).toBeLessThanOrEqual(WORLD_ISO_MAX_PROP_TILES);
 });

 it("leaves props of three tiles or less alone", () => {
  expect(worldIsoSliceBox({ id: "sofa", u1: 7, v1: 8.6, u2: 10, v2: 9.6 })).toEqual([{ id: "sofa", u1: 7, v1: 8.6, u2: 10, v2: 9.6 }]);
 });

 it("sorts a character correctly against each slice of a long counter", () => {
  const items = [...worldIsoSliceBox({ id: "counter", u1: 0, v1: 5, u2: 9, v2: 6 }).map(s => prop(s.id, s.u1, s.v1, s.u2, s.v2)), actor("pal", 7.5, 4.5)];
  const { order } = worldIsoDepthOrder(items);
  // The character stands behind the counter's far slice, which overlaps it on screen.
  expect(before(order, "pal", "counter#2")).toBe(true);
  expect(order).toHaveLength(4);
 });
});

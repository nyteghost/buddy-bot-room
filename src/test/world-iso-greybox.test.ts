import { describe, expect, it } from "vitest";
import { HD_OFFICE_CHAT_PAIRS, HD_OFFICE_SPOTS } from "@/lib/world-hd-office";
import { WORLD_ISO_MAX_PROP_TILES, worldIsoActorBox, worldIsoDepthOrder, type WorldIsoDepthItem } from "@/lib/world-iso-depth";
import { WORLD_ISO_GREYBOX, WORLD_ISO_GREYBOX_CHAT_PAIRS } from "@/lib/world-iso-greybox";
import { WORLD_ISO_ANCHOR_SPACING, worldIsoBoxGap, worldIsoPath, worldIsoPathLength, worldIsoPointFree, worldIsoValidatePlan } from "@/lib/world-iso-ground";
import { WORLD_ISO_CANVAS, worldIsoProjection } from "@/lib/world-iso-projection";

const plan = WORLD_ISO_GREYBOX;
const byId = new Map(plan.anchors.map(a => [a.id, a]));
const seats = plan.anchors.filter(a => a.kind === "seat");
const desks = plan.colliders.filter(c => c.id.startsWith("desk-"));

describe("grey-box Office plan (synthetic coordinates, no art)", () => {
 it("passes the plan validator: floor, ids, door, colliders, reachability, spacing, seat links", () => {
  const report = worldIsoValidatePlan(plan);
  expect(report.problems).toEqual([]);
  expect(report.ok).toBe(true);
 });

 it("has nine workstations in Pal order and six visitor homes", () => {
  expect(seats.map(s => s.id)).toEqual(Array.from({ length: 9 }, (_, i) => `seat-${i}`));
  expect(seats.map(s => s.desk)).toEqual([0, 1, 2, 3, 4, 5, 6, 7, 8]);
  expect(desks).toHaveLength(9);
  expect(plan.anchors.filter(a => a.kind === "visitor")).toHaveLength(6);
 });

 it("turns every seated face toward the viewer (SE or SW)", () => {
  for (const s of seats) expect(["se", "sw"]).toContain(s.facing);
  expect(seats.slice(0, 3).every(s => s.facing === "sw")).toBe(true); // north bank, chairs on the window-wall side
  expect(seats.slice(3).every(s => s.facing === "se")).toBe(true);    // library and systems banks
 });

 it("puts each seat's own desk in front of the seated character, never covering the face from behind", () => {
  for (const s of seats) {
   const items: WorldIsoDepthItem[] = [...desks.map(d => ({ id: d.id, layer: "prop" as const, box: d })), { id: "pal", layer: "actor", box: worldIsoActorBox(s.at) }];
   const { order } = worldIsoDepthOrder(items);
   expect(order.indexOf("pal")).toBeLessThan(order.indexOf(s.front!));
  }
 });

 it("gives every seat a free standing fallback for characters without sitting art", () => {
  for (const s of seats) {
   const stand = byId.get(s.standFallback!);
   expect(stand?.kind).toBe("stand");
   expect(stand?.desk).toBe(s.desk);
   expect(worldIsoPointFree(plan, stand!.at)).toBe(true);
  }
 });

 it("reaches all 9 seats and 6 visitor homes from the door with the footprint clear", () => {
  const door = byId.get(plan.door)!;
  for (const a of plan.anchors.filter(x => x.kind === "seat" || x.kind === "visitor")) {
   const path = worldIsoPath(plan, door.at, a.at);
   expect(path).not.toBeNull();
   expect(worldIsoPathLength(path!)).toBeLessThan(40);
  }
 });

 it("keeps at least 1.2 tiles between desks so seats can be reached between them", () => {
  for (let i = 0; i < desks.length; i++) for (let j = i + 1; j < desks.length; j++) expect(worldIsoBoxGap(desks[i]!, desks[j]!)).toBeGreaterThanOrEqual(1.2 - 1e-9);
 });

 it("lets all 15 characters (9 Pals seated + 6 visitors home) stand at once without overlapping", () => {
  const occupied = plan.anchors.filter(a => a.kind === "seat" || a.kind === "visitor");
  expect(occupied).toHaveLength(15);
  for (let i = 0; i < occupied.length; i++) for (let j = i + 1; j < occupied.length; j++) {
   const a = occupied[i]!.at, b = occupied[j]!.at;
   expect(Math.hypot(a.u - b.u, a.v - b.v)).toBeGreaterThanOrEqual(WORLD_ISO_ANCHOR_SPACING);
  }
 });

 it("keeps visitor homes out of the work block (at least 1.5 tiles from every desk)", () => {
  for (const v of plan.anchors.filter(a => a.kind === "visitor"))
   for (const d of desks) expect(Math.hypot(Math.max(0, d.u1 - v.at.u, v.at.u - d.u2), Math.max(0, d.v1 - v.at.v, v.at.v - d.v2))).toBeGreaterThanOrEqual(1.5);
 });

 it("keeps every anchor id the flat HD office uses, so schedules and desk mapping carry over", () => {
  for (const spot of HD_OFFICE_SPOTS) expect(byId.has(spot.id)).toBe(true);
  expect(WORLD_ISO_GREYBOX_CHAT_PAIRS).toEqual(HD_OFFICE_CHAT_PAIRS);
  for (const spot of HD_OFFICE_SPOTS.filter(s => s.desk !== undefined)) expect(byId.get(spot.id)?.desk).toBe(spot.desk);
 });

 it("faces chat partners toward each other", () => {
  const iso = worldIsoProjection();
  for (const [a, b] of WORLD_ISO_GREYBOX_CHAT_PAIRS) {
   const A = byId.get(a)!, B = byId.get(b)!, s = iso.screenVector(B.at.u - A.at.u, B.at.v - A.at.v);
   expect(s.y).toBeCloseTo(0, 9); // same screen row
   expect(s.x).toBeGreaterThan(0);
   expect([A.facing, B.facing]).toEqual(["e", "w"]);
  }
 });

 it("fits the floor and every prop inside the shared canvas, with no prop longer than three tiles", () => {
  const iso = worldIsoProjection();
  for (const c of plan.colliders) {
   for (const corner of [{ u: c.u1, v: c.v1 }, { u: c.u2, v: c.v2 }, { u: c.u1, v: c.v2 }, { u: c.u2, v: c.v1 }]) {
    const s = iso.toScreen(corner);
    expect(s.x).toBeGreaterThanOrEqual(0); expect(s.x).toBeLessThanOrEqual(WORLD_ISO_CANVAS.width);
    expect(s.y).toBeGreaterThanOrEqual(0); expect(s.y).toBeLessThanOrEqual(WORLD_ISO_CANVAS.height);
   }
   expect(Math.max(c.u2 - c.u1, c.v2 - c.v1)).toBeLessThanOrEqual(WORLD_ISO_MAX_PROP_TILES);
  }
 });

 it("is frozen, so no caller can change the shared plan", () => {
  expect(Object.isFrozen(plan)).toBe(true);
  expect(Object.isFrozen(plan.anchors)).toBe(true);
 });
});

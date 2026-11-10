import { describe, expect, it } from "vitest";
import { worldIsoActorBox, worldIsoDepthOrder } from "@/lib/world-iso-depth";
import { WORLD_ISO_FACING_ANGLES } from "@/lib/world-iso-facing";
import { WORLD_ISO_GREYBOX } from "@/lib/world-iso-greybox";
import { worldIsoPlanSealed } from "@/lib/world-iso-ground";
import { worldIsoProjection } from "@/lib/world-iso-projection";
import { worldIsoFacingWedge, worldIsoPropHeight, worldIsoScene } from "@/lib/world-iso-scene";
import { WORLD_HD_DIRECTIONS } from "@/lib/world-hd";

const built = worldIsoScene();
if (!built.ok) throw new Error("grey-box scene did not build");
const scene = built, iso = worldIsoProjection();

describe("synthetic grey-box scene (Stage 2)", () => {
 it("is built from the sealed, fully validated plan on the approved 2:1 projection", () => {
  expect(scene.ok).toBe(true);
  expect(worldIsoPlanSealed(scene.plan)).toBe(true);
  expect(scene.canvas).toEqual({ width: 2752, height: 1600 });
  expect(scene.floor).toEqual([{ x: 1216, y: 400 }, { x: 2432, y: 1008 }, { x: 1536, y: 1456 }, { x: 320, y: 848 }]); // 19 × 14 tiles of 128 × 64
  expect(scene.grid).toHaveLength(20 + 15);
  expect(scene.walls).toHaveLength(2);
 });

 it("has nine workstations and six visitor homes, in the same order as today's desks", () => {
  const seats = scene.markers.filter(m => m.kind === "seat"), homes = scene.markers.filter(m => m.kind === "visitor");
  expect(seats.map(m => m.id)).toEqual(Array.from({ length: 9 }, (_, i) => `seat-${i}`));
  expect(seats.map(m => m.desk)).toEqual([0, 1, 2, 3, 4, 5, 6, 7, 8]);
  expect(homes.map(m => m.id)).toEqual(Array.from({ length: 6 }, (_, i) => `visitor-home-${i}`));
  expect(scene.markers.filter(m => m.kind === "stand")).toHaveLength(9);
  expect(scene.markers.filter(m => m.kind === "door")).toHaveLength(1);
  for (const m of seats) expect(["se", "sw"]).toContain(m.facing);
 });

 it("draws one grey block per collider with three visible faces, all inside the canvas", () => {
  expect(scene.props.map(p => p.collider).sort()).toEqual(WORLD_ISO_GREYBOX.colliders.map(c => c.id).sort());
  for (const p of scene.props) {
   expect(p.top).toHaveLength(4); expect(p.left).toHaveLength(4); expect(p.right).toHaveLength(4);
   expect(p.height).toBe(worldIsoPropHeight(p.collider));
   for (const q of [...p.top, ...p.left, ...p.right]) { expect(q.x).toBeGreaterThanOrEqual(0); expect(q.x).toBeLessThanOrEqual(2752); expect(q.y).toBeGreaterThanOrEqual(0); expect(q.y).toBeLessThanOrEqual(1600); }
   expect(p.top[0]!.y).toBeLessThan(iso.toScreen({ u: p.box.u1, v: p.box.v1 }).y); // the top is raised above the floor
   expect(p.bounds.width).toBeGreaterThan(0); expect(p.bounds.height).toBeGreaterThan(0);
  }
  expect(worldIsoPropHeight("desk-3")).toBe(1.1);
  expect(worldIsoPropHeight("shelf-tall")).toBeGreaterThan(4);
  expect(worldIsoPropHeight("unknown-thing")).toBe(0.8);
 });

 it("puts every marker on its ground point and points its wedge the way the anchor faces", () => {
  for (const m of scene.markers) {
   expect(m.screen).toEqual(iso.toScreen(m.at));
   const tip = m.wedge[0]!, angle = (Math.atan2(tip.y - m.screen.y, tip.x - m.screen.x) * 180 / Math.PI + 360) % 360;
   const want = WORLD_ISO_FACING_ANGLES[m.facing], gap = Math.min(Math.abs(angle - want), 360 - Math.abs(angle - want));
   expect(gap).toBeLessThan(0.001);
  }
  const tips = WORLD_HD_DIRECTIONS.map(d => worldIsoFacingWedge(iso, { u: 5, v: 5 }, d)[0]!);
  expect(new Set(tips.map(t => `${t.x.toFixed(2)},${t.y.toFixed(2)}`)).size).toBe(8); // eight distinct facings
 });

 it("gives the depth sort items that order furniture and characters correctly", () => {
  const order = (u: number, v: number) => worldIsoDepthOrder([...scene.depthItems, { id: "pal", layer: "actor", box: worldIsoActorBox({ u, v }) }]).order;
  const seat0 = scene.markers.find(m => m.id === "seat-0")!;
  expect(order(seat0.at.u, seat0.at.v).indexOf("pal")).toBeLessThan(order(seat0.at.u, seat0.at.v).indexOf("desk-0")); // seated: behind own desk
  expect(order(12.5, 5.4).indexOf("pal")).toBeLessThan(order(12.5, 5.4).indexOf("shelf-tall"));                        // behind the shelf
  expect(order(12.5, 7.1).indexOf("pal")).toBeGreaterThan(order(12.5, 7.1).indexOf("shelf-tall"));                     // in front of it
  expect(worldIsoDepthOrder([...scene.depthItems]).cycles).toBe(0);
 });

 it("is frozen and the same every time", () => {
  expect(Object.isFrozen(scene) && Object.isFrozen(scene.props) && Object.isFrozen(scene.markers) && Object.isFrozen(scene.props[0])).toBe(true);
  expect(JSON.stringify(worldIsoScene())).toBe(JSON.stringify(scene));
 });

 it("returns problems and nothing to draw for an invalid plan, without throwing", () => {
  const bad: unknown[] = [null, 7, {}, { id: "x", floor: [], colliders: [], anchors: [], door: "door" },
   { id: "bow", floor: [{ u: 0, v: 0 }, { u: 6, v: 6 }, { u: 6, v: 0 }, { u: 0, v: 6 }], colliders: [], anchors: [], door: "door" },
   { id: "huge", floor: [{ u: 0, v: 0 }, { u: 1e6, v: 0 }, { u: 1e6, v: 1e6 }, { u: 0, v: 1e6 }], colliders: [], anchors: [], door: "door" },
   { id: "no-door", floor: [{ u: 0, v: 0 }, { u: 8, v: 0 }, { u: 8, v: 8 }, { u: 0, v: 8 }], colliders: [], anchors: [], door: "door" }];
  for (const plan of bad) {
   const result = worldIsoScene(plan);
   expect(result.ok).toBe(false);
   if (!result.ok) expect(result.problems.length).toBeGreaterThan(0);
  }
  expect(worldIsoScene(WORLD_ISO_GREYBOX, iso, Number.NaN).ok).toBe(false);
 });
});

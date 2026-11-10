import { describe, expect, it } from "vitest";
import { HD_OFFICE_SPOTS, HD_OFFICE_WORLD } from "@/lib/world-hd-office";
import { WORLD_ISO_FLOOR, WORLD_ISO_PARAMS, worldFlatProjection, worldIsoFloorCorners, worldIsoProjection } from "@/lib/world-iso-projection";

describe("isometric projection (2:1 dimetric)", () => {
 const iso = worldIsoProjection();

 it("uses the approved Desktop HD values", () => {
  expect(WORLD_ISO_PARAMS).toEqual({ tileWidth: 128, origin: { x: 1216, y: 400 }, heightScale: 64 });
  expect(WORLD_ISO_FLOOR).toEqual({ u: 19, v: 14 });
 });

 it("puts the 19 × 14 floor corners on the backdrop pixels given to the designer", () => {
  expect(worldIsoFloorCorners(iso)).toEqual([{ x: 1216, y: 400 }, { x: 2432, y: 1008 }, { x: 1536, y: 1456 }, { x: 320, y: 848 }]);
  for (const c of worldIsoFloorCorners(iso)) {
   expect(c.x).toBeGreaterThanOrEqual(0); expect(c.x).toBeLessThanOrEqual(2752);
   expect(c.y).toBeGreaterThanOrEqual(0); expect(c.y).toBeLessThanOrEqual(1600);
  }
 });

 it("draws one tile as a diamond twice as wide as it is tall", () => {
  const a = iso.toScreen({ u: 5, v: 5 }), right = iso.toScreen({ u: 6, v: 5 }), left = iso.toScreen({ u: 5, v: 6 });
  expect([right.x - a.x, right.y - a.y]).toEqual([64, 32]);
  expect([left.x - a.x, left.y - a.y]).toEqual([-64, 32]);
  const across = iso.toScreen({ u: 6, v: 6 });
  expect(across.x - a.x).toBe(0); expect(across.y - a.y).toBe(64);
 });

 it("round-trips ground → screen → ground within 0.001 tile", () => {
  for (let u = -2; u <= 21; u += 0.37) for (let v = -2; v <= 16; v += 0.41) {
   const back = iso.toGround(iso.toScreen({ u, v }));
   expect(Math.abs(back.u - u)).toBeLessThan(1e-3);
   expect(Math.abs(back.v - v)).toBeLessThan(1e-3);
  }
 });

 it("raises height straight up by 64 px per tile and never moves the ground point", () => {
  const ground = iso.toScreen({ u: 3, v: 4 }), lamp = iso.toScreen({ u: 3, v: 4 }, 2.5);
  expect(lamp.x).toBe(ground.x); expect(ground.y - lamp.y).toBe(160);
 });

 it("orders depth as u + v: nearer the viewer is drawn later", () => {
  expect(iso.depthOf({ u: 10, v: 10 })).toBeGreaterThan(iso.depthOf({ u: 2, v: 3 }));
  expect(iso.depthOf({ u: 4, v: 1 })).toBe(iso.depthOf({ u: 1, v: 4 }));
 });

 it("keeps characters the same size everywhere (no perspective scaling)", () => {
  const d1 = iso.screenVector(1, 0), d2 = iso.screenVector(1, 0);
  expect(d1).toEqual(d2);
  const near = iso.toScreen({ u: 18, v: 13 }, 1), nearFloor = iso.toScreen({ u: 18, v: 13 });
  const far = iso.toScreen({ u: 1, v: 1 }, 1), farFloor = iso.toScreen({ u: 1, v: 1 });
  expect(nearFloor.y - near.y).toBe(farFloor.y - far.y);
 });

 it("rejects invalid parameters", () => {
  const throws = (f: () => unknown) => { try { f(); return false; } catch { return true; } };
  expect(throws(() => worldIsoProjection({ tileWidth: 0, origin: { x: 0, y: 0 }, heightScale: 64 }))).toBe(true);
  expect(throws(() => worldIsoProjection({ tileWidth: Number.NaN, origin: { x: 0, y: 0 }, heightScale: 64 }))).toBe(true);
  expect(throws(() => worldFlatProjection({ width: 0, height: 1600 }))).toBe(true);
 });
});

describe("flat projection (today's HD office, unchanged behaviour)", () => {
 const flat = worldFlatProjection(HD_OFFICE_WORLD);

 it("matches the current x / 100 * W, y / 100 * H placement for every office spot", () => {
  for (const spot of HD_OFFICE_SPOTS) {
   const s = flat.toScreen({ u: spot.point.x, v: spot.point.y });
   expect(s.x).toBeCloseTo(spot.point.x / 100 * HD_OFFICE_WORLD.width, 9);
   expect(s.y).toBeCloseTo(spot.point.y / 100 * HD_OFFICE_WORLD.height, 9);
   const back = flat.toGround(s);
   expect(back.u).toBeCloseTo(spot.point.x, 9); expect(back.v).toBeCloseTo(spot.point.y, 9);
  }
 });

 it("orders like the current z-index (round(feet y × 10))", () => {
  const spots = [...HD_OFFICE_SPOTS];
  for (const a of spots) for (const b of spots) {
   const zA = Math.round(a.point.y * 10), zB = Math.round(b.point.y * 10);
   if (zA === zB) continue;
   expect(Math.sign(flat.depthOf({ u: a.point.x, v: a.point.y }) - flat.depthOf({ u: b.point.x, v: b.point.y }))).toBe(Math.sign(zA - zB));
  }
 });

 it("ignores height (the flat room has no height axis)", () => {
  expect(flat.toScreen({ u: 40, v: 60 }, 3)).toEqual(flat.toScreen({ u: 40, v: 60 }));
  expect(flat.kind).toBe("flat");
 });
});

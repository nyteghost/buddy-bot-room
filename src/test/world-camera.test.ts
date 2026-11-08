import { describe, expect, it } from "vitest";
import { screenToWorld, worldCameraClamp, worldCameraFit, worldCameraFollow, worldCameraLimits, worldCameraPan, worldCameraPinch, worldCameraTransform,
 worldCameraVisible, worldCameraZoomAt, worldToScreen } from "@/lib/world-camera";
import { cleanWorldPresentationChoice, worldArtSource, worldPresentation, worldPresentationDefault } from "@/lib/world-presentation";

const world = { width: 3440, height: 2000 }, desktop = { width: 900, height: 523 }, phone = { width: 366, height: 213 };

describe("Living Universe HD camera (prototype groundwork)", () => {
 it("never letterboxes and never zooms past native detail", () => {
  const l = worldCameraLimits(world, desktop);
  expect(l.min).toBeCloseTo(Math.max(900 / 3440, 523 / 2000), 6);
  expect(l.max).toBe(1);
  const fit = worldCameraFit(world, desktop);
  const vis = worldCameraVisible(fit, desktop);
  expect(vis.x1).toBeGreaterThanOrEqual(-1e-6); expect(vis.y1).toBeGreaterThanOrEqual(-1e-6);
  expect(vis.x2).toBeLessThanOrEqual(world.width + 1e-6); expect(vis.y2).toBeLessThanOrEqual(world.height + 1e-6);
  expect(worldCameraClamp({ x: -500, y: 99999, zoom: 9 }, world, desktop).zoom).toBe(1);
 });
 it("maps screen and world both ways and builds the layer transform", () => {
  const cam = { x: 1000, y: 800, zoom: 0.5 };
  const p = { x: 123, y: 456 };
  const w = screenToWorld(cam, desktop, p);
  expect(worldToScreen(cam, desktop, w).x).toBeCloseTo(p.x, 9);
  expect(worldToScreen(cam, desktop, w).y).toBeCloseTo(p.y, 9);
  expect(worldCameraTransform(cam, desktop)).toBe("translate(-50px, -138.5px) scale(0.5)");
 });
 it("zooms around the cursor and pans with the pointer, staying inside the world", () => {
  const start = { x: 1700, y: 1000, zoom: 0.5 }, at = { x: 700, y: 200 };
  const before = screenToWorld(start, desktop, at);
  const zoomed = worldCameraZoomAt(start, 1.6, at, world, desktop);
  const after = screenToWorld(zoomed, desktop, at);
  expect(zoomed.zoom).toBeCloseTo(0.8, 9);
  expect(after.x).toBeCloseTo(before.x, 6); expect(after.y).toBeCloseTo(before.y, 6);
  const panned = worldCameraPan(zoomed, 100, -50, world, desktop);
  expect(panned.x).toBeCloseTo(zoomed.x - 100 / 0.8, 6);
  expect(panned.y).toBeCloseTo(zoomed.y + 50 / 0.8, 6);
  const far = worldCameraPan(zoomed, 1e6, 1e6, world, desktop);
  expect(worldCameraVisible(far, desktop).x1).toBeCloseTo(0, 6);
 });
 it("pinch zooms by finger distance around the midpoint", () => {
  const cam = { x: 1700, y: 1000, zoom: 0.4 };
  const out = worldCameraPinch(cam, [{ x: 150, y: 100 }, { x: 210, y: 100 }], [{ x: 120, y: 100 }, { x: 240, y: 100 }], world, phone);
  expect(out.zoom).toBeCloseTo(0.8, 6);
  const mid = { x: 180, y: 100 };
  expect(screenToWorld(out, phone, mid).x).toBeCloseTo(screenToWorld(cam, phone, mid).x, 6);
 });
 it("follows outside a dead zone, eases, and snaps with reduced motion", () => {
  const cam = { x: 1700, y: 1000, zoom: 1 };
  expect(worldCameraFollow(cam, { x: 1750, y: 1010 }, 16, world, desktop)).toEqual(cam);
  const eased = worldCameraFollow(cam, { x: 2600, y: 1000 }, 100, world, desktop);
  expect(eased.x).toBeGreaterThan(1700); expect(eased.x).toBeLessThan(2600 - 900 * 0.15);
  const snapped = worldCameraFollow(cam, { x: 2600, y: 1000 }, 16, world, desktop, { reduced: true });
  expect(snapped.x).toBeCloseTo(2600 - 900 * 0.15, 6);
 });
});

describe("Living Universe presentation defaults (planning groundwork)", () => {
 it("defaults phones and low-power devices to Pixel, desktops and tablets to HD; a manual choice always wins", () => {
  expect(worldPresentationDefault({ width: 390, coarse: true })).toBe("pixel");
  expect(worldPresentationDefault({ width: 1440, coarse: false })).toBe("hd");
  expect(worldPresentationDefault({ width: 1024, coarse: true })).toBe("hd");
  expect(worldPresentationDefault({ width: 1440, coarse: false, lowPower: true })).toBe("pixel");
  expect(worldPresentation("hd", { width: 390, coarse: true })).toBe("hd");
  expect(worldPresentation("pixel", { width: 1440, coarse: false })).toBe("pixel");
  expect(worldPresentation("auto", { width: 1440, coarse: false })).toBe("hd");
  expect(cleanWorldPresentationChoice("4k")).toBe("auto");
 });
 it("always has an art fallback and never treats downsampled HD as production pixel art", () => {
  expect(worldArtSource("hd", { hd: true, mini: true, native: true })).toBe("hd");
  expect(worldArtSource("hd", { hd: false, mini: false, native: true })).toBe("native");
  expect(worldArtSource("pixel", { hd: true, mini: false, native: true })).toBe("native");
  expect(worldArtSource("pixel", { hd: true, mini: false, native: false })).toBe("hd-downsampled");
  expect(worldArtSource("pixel", { hd: true, mini: true, native: true })).toBe("mini");
 });
});

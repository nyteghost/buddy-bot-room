import { describe, expect, it } from "vitest";
import { clampWindowPosition, readWindowPosition, resizeWindowRect, type WindowResizeEdge } from "@/lib/workspace";

describe("movable workspace", () => {
  it("keeps a dragged window within the workspace", () => {
    expect(clampWindowPosition({ x: -90, y: 900 }, { width: 1000, height: 700 }, { width: 400, height: 300 })).toEqual({ x: 0, y: 400 });
  });
  it("keeps windows reachable after the workspace gets smaller", () => {
    expect(clampWindowPosition({ x: 600, y: 400 }, { width: 500, height: 200 }, { width: 550, height: 300 })).toEqual({ x: 0, y: 0 });
  });
  it("restores finite positions without trusting broken browser data", () => {
    expect(readWindowPosition('{"x":42,"y":75}')).toEqual({ x: 42, y: 75 });
    expect(readWindowPosition('{"x":"42","y":75}')).toBeNull();
    expect(readWindowPosition('broken')).toBeNull();
  });
});
describe("four-side window resizing", () => {
  const base = { x: 150, y: 100, w: 400, h: 300 };
  const bounds = { width: 1000, height: 700 };
  it("dragging the left side left grows width without moving the right edge", () => {
    expect(resizeWindowRect(base, { x: -100, y: 0 }, "w", bounds)).toEqual({ x: 50, y: 100, w: 500, h: 300 });
  });
  it("dragging the top up grows height without moving the bottom edge", () => {
    expect(resizeWindowRect(base, { x: 0, y: -70 }, "n", bounds)).toEqual({ x: 150, y: 30, w: 400, h: 370 });
  });
  it("preserves the original top-left for east or south resizing", () => {
    expect(resizeWindowRect(base, { x: 200, y: 0 }, "e", bounds)).toEqual({ x: 150, y: 100, w: 600, h: 300 });
    expect(resizeWindowRect(base, { x: 0, y: 100 }, "s", bounds)).toEqual({ x: 150, y: 100, w: 400, h: 400 });
  });
  it.each<WindowResizeEdge>(["n", "s", "e", "w", "ne", "nw", "se", "sw"])("keeps the %s edge inside the canvas", (edge) => {
    for (const delta of [{ x: -10000, y: -10000 }, { x: 10000, y: 10000 }]) {
      const r = resizeWindowRect(base, delta, edge, bounds);
      expect(r.x).toBeGreaterThanOrEqual(0);
      expect(r.y).toBeGreaterThanOrEqual(0);
      expect(r.w).toBeGreaterThanOrEqual(320);
      expect(r.h).toBeGreaterThanOrEqual(220);
      expect(r.x + r.w).toBeLessThanOrEqual(bounds.width);
      expect(r.y + r.h).toBeLessThanOrEqual(bounds.height);
    }
  });
  it("supports all corners and keeps the opposite corner fixed", () => {
    expect(resizeWindowRect(base, { x: -40, y: -30 }, "nw", bounds)).toEqual({ x: 110, y: 70, w: 440, h: 330 });
    expect(resizeWindowRect(base, { x: -40, y: 40 }, "sw", bounds)).toEqual({ x: 110, y: 100, w: 440, h: 340 });
    expect(resizeWindowRect(base, { x: 40, y: -30 }, "ne", bounds)).toEqual({ x: 150, y: 70, w: 440, h: 330 });
    expect(resizeWindowRect(base, { x: 40, y: 40 }, "se", bounds)).toEqual({ x: 150, y: 100, w: 440, h: 340 });
  });
  it("keeps the opposite edge anchored when shrinking into the minimum size", () => {
    expect(resizeWindowRect(base, { x: 200, y: 0 }, "w", bounds)).toEqual({ x: 230, y: 100, w: 320, h: 300 });
    expect(resizeWindowRect(base, { x: 0, y: 180 }, "n", bounds)).toEqual({ x: 150, y: 180, w: 400, h: 220 });
  });
  it("fits available space on a canvas smaller than the minimum window size", () => {
    const r = resizeWindowRect({ x: 0, y: 0, w: 260, h: 190 }, { x: 40, y: 40 }, "se", { width: 260, height: 190 });
    expect(r).toEqual({ x: 0, y: 0, w: 260, h: 190 });
  });
});

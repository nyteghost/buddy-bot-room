import { describe, expect, it } from "vitest";
import { clampWindowPosition, readWindowPosition } from "@/lib/workspace";

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
import { describe, expect, it } from "vitest";
import { fitWindowRect, presetWindowRects, readWorkspaceLayout, scaleWorkspaceLayout, snapRect, snapZone } from "@/lib/workspace";

describe("window snap geometry", () => {
  const canvas = { width: 1000, height: 700 };
  it("detects left, right and top edge docking", () => {
    expect(snapZone({ x: 4, y: 340 }, canvas)).toBe("left");
    expect(snapZone({ x: 999, y: 340 }, canvas)).toBe("right");
    expect(snapZone({ x: 500, y: 4 }, canvas)).toBe("top");
    expect(snapZone({ x: 500, y: 350 }, canvas)).toBeNull();
    expect(snapZone({ x: -1, y: 30 }, canvas)).toBeNull();
  });
  it("fills half or all of the canvas without gaps", () => {
    expect(snapRect("left", canvas)).toEqual({ x: 0, y: 0, w: 500, h: 700 });
    expect(snapRect("right", canvas)).toEqual({ x: 500, y: 0, w: 500, h: 700 });
    expect(snapRect("top", canvas)).toEqual({ x: 0, y: 0, w: 1000, h: 700 });
    expect(snapRect("right", { width: 1001, height: 500 }).w).toBe(501);
  });
  it("clamps geometry inside the workspace", () => {
    expect(fitWindowRect({ x: 900, y: -50, w: 400, h: 900 }, canvas)).toEqual({ x: 600, y: 0, w: 400, h: 700 });
  });
});
describe("named and saved workspace layouts", () => {
  it("creates Chat, Mail, Work and Server arrangements", () => {
    const canvas = { width: 1000, height: 700 };
    const chat = presetWindowRects("chat", canvas);
    expect(chat.room).toEqual({ x: 0, y: 0, w: 500, h: 700 });
    expect(chat["mode-roundtable"]).toEqual({ x: 500, y: 0, w: 500, h: 700 });
    expect(Object.keys(presetWindowRects("mail", canvas))).toEqual(["mail"]);
    expect(Object.keys(presetWindowRects("work", canvas))).toEqual(["tools", "documents"]);
    expect(Object.keys(presetWindowRects("server", canvas))).toEqual(["today", "setup"]);
  });
  it("fits compact screens and restores saved coordinates proportionally", () => {
    const layout = readWorkspaceLayout(JSON.stringify({ canvas: { width: 1000, height: 700 }, windows: { mail: { x: 500, y: 0, w: 500, h: 700 } } }));
    expect(layout).not.toBeNull();
    expect(scaleWorkspaceLayout(layout!, { width: 600, height: 400 }).mail).toEqual({ x: 300, y: 0, w: 300, h: 400 });
    expect(presetWindowRects("work", { width: 600, height: 400 }).documents.w).toBe(600);
  });
  it("rejects malformed saved layouts instead of applying them", () => {
    expect(readWorkspaceLayout("bad json")).toBeNull();
    expect(readWorkspaceLayout('{"canvas":{"width":0,"height":400},"windows":{}}')).toBeNull();
    expect(readWorkspaceLayout(JSON.stringify({ canvas: { width: 1000, height: 700 }, windows: { mail: { x: NaN, y: 0, w: -1, h: 600 } } }))).toBeNull();
    expect(readWorkspaceLayout(null)).toBeNull();
  });
});

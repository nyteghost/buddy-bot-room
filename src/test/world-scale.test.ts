import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { WORLD_HUMAN_ROWS, worldGridFoot, worldGroundGrid, worldHdScale, worldHumanHeight, worldPixelSize } from "@/lib/world-scale";
import { worldAlphaBounds } from "@/lib/world-hd-render";
import { validateWorldHdCharacter } from "@/lib/world-hd";
import { worldHdCoverage } from "@/lib/world-hd-animation";
import { characterSprite } from "@/lib/character-sprites";
import { WORLD_LEG_EXTENSION, worldLegRow, worldPalBody, worldTallSprite } from "@/lib/world-proportions";
import { hdPng } from "./character-hd-fixture";
const PNG_256 = "data:image/png;base64," + hdPng().toString("base64");

describe("one in-room scale for the cast", () => {
 it("mirrors the --world-pixel rules in styles.css", () => {
  const css = readFileSync("src/styles.css", "utf8");
  expect(css).toContain(".room-scene.living-world{--world-pixel:2px;}");
  expect(css).toContain("@media (min-resolution:1.2dppx) and (max-resolution:1.3dppx){.room-scene.living-world{--world-pixel:1.6px;}}");
  expect(css).toContain("@media (max-width:700px){.room-scene.living-world{--world-pixel:1.5px;}}");
  expect(css).toContain("@media (max-width:700px) and (min-resolution:2.5dppx){.room-scene.living-world{--world-pixel:1.3334px;}}");
  expect([worldPixelSize(false, 1), worldPixelSize(false, 1.25), worldPixelSize(false, 2), worldPixelSize(true, 2), worldPixelSize(true, 3)]).toEqual([2, 1.6, 2, 1.5, 1.3334]);
  expect(worldHumanHeight(2)).toBe(70);
 });

 it("native adult Pals already stand the standard height", () => {
  for (const id of ["nova", "byte", "pip", "rune", "saiyan"] as const) {
   const front = characterSprite(id, "matrix");
   const tall = worldTallSprite(front, WORLD_LEG_EXTENSION[worldPalBody(id)], worldLegRow("scale-test:" + id, () => front));
   const top = tall.findIndex(row => row.replace(/\./g, ""));
   expect(worldGridFoot(tall) - top + 1).toBe(WORLD_HUMAN_ROWS);
  }
 });

 it("puts native feet on the anchor without moving lifted or lower frames", () => {
  const grid = ["....", ".##.", ".#.#", "....", "...."];
  expect(worldGridFoot(grid)).toBe(2);
  expect(worldGroundGrid(grid, 2)).toEqual(["....", ".##.", ".#.#"]);
  // A hop frame drawn higher keeps the same standing line, so it still rises.
  expect(worldGroundGrid(["....", ".##.", "....", "....", "...."], 2)).toHaveLength(3);
  // Art drawn below the standing line is never cropped.
  expect(worldGroundGrid(["....", ".##.", ".#.#", "#...", "...."], 2)).toHaveLength(5);
  expect(worldGroundGrid(grid, -1)).toEqual(grid);
 });

 it("sizes painted HD art to the standard adult height and lowers it to its own feet", () => {
  // Typical painted designer pack: figure rows 14–249, no pixel grid.
  const s = worldHdScale({ metrics: { grid: 1, top: 14, foot: 249 }, worldPixel: 2, devicePixelRatio: 2 });
  expect(s.crisp).toBe(false);
  expect(s.heightRatio).toBeCloseTo(1, 2);
  expect(s.size).toBeCloseTo(70 * 256 / 236, 2);
  expect(s.footOffset).toBeCloseTo(6 * s.size / 256, 2);
  // A figure with a different baseline still meets the same floor line.
  const low = worldHdScale({ metrics: { grid: 1, top: 16, foot: 239 }, worldPixel: 2, devicePixelRatio: 2 });
  expect(low.heightRatio).toBeCloseTo(1, 2);
  expect(low.footOffset).toBeGreaterThan(s.footOffset);
 });

 it("keeps grid art crisp only when that stays close to the intended height, and reports the difference", () => {
  // Nova prototype: 64×64 master (4×), figure fills rows 0–247 (62 art px).
  const nova = worldHdScale({ metrics: { grid: 4, top: 0, foot: 247 }, worldPixel: 2, devicePixelRatio: 2 });
  expect(nova).toMatchObject({ crisp: true, size: 64, footOffset: 2 });
  expect(nova.heightRatio).toBeCloseTo(0.886, 3);
  // Documented target: 128×128 master (2×), adult figure 70 art px → exact and crisp on 1×, 2× and 3× iPhone.
  const spec = { grid: 2, top: 108, foot: 247 };
  for (const [phone, dpr] of [[false, 1], [false, 2], [true, 3]] as const) {
   const r = worldHdScale({ metrics: spec, worldPixel: worldPixelSize(phone, dpr), devicePixelRatio: dpr });
   expect(r.crisp).toBe(true);
   expect(r.heightRatio).toBeCloseTo(1, 3);
   expect(r.artPixel * dpr).toBeCloseTo(Math.round(r.artPixel * dpr), 2);
  }
  // Grid art far from any whole multiple keeps the exact height instead of jumping a size.
  const off = worldHdScale({ metrics: { grid: 4, top: 8, foot: 247 }, worldPixel: 2, devicePixelRatio: 1 }); // nearest crisp size is 14% short
  expect(off.crisp).toBe(false);
  expect(off.heightRatio).toBeCloseTo(1, 3);
 });

 it("applies declared height classes as intentional exceptions", () => {
  const metrics = { grid: 1, top: 16, foot: 240 };
  const adult = worldHdScale({ metrics, worldPixel: 2, devicePixelRatio: 1 });
  const small = worldHdScale({ metrics, height: "small", worldPixel: 2, devicePixelRatio: 1 });
  const huge = worldHdScale({ metrics, height: "huge", worldPixel: 2, devicePixelRatio: 1 });
  expect(small.size / adult.size).toBeCloseTo(0.6, 3);
  expect(huge.size / adult.size).toBeCloseTo(1.5, 3);
  // Unknown values fall back to adult rather than to an arbitrary scale.
  expect(worldHdScale({ metrics, height: "giant" as never, worldPixel: 2, devicePixelRatio: 1 }).size).toBe(adult.size);
  // Unmeasured art (decode pending) assumes the documented layout.
  expect(worldHdScale({ metrics: null, worldPixel: 2, devicePixelRatio: 1 }).heightRatio).toBeCloseTo(1, 3);
 });

 it("measures figure bounds from RGBA data", () => {
  const w = 4, h = 5, data = new Uint8ClampedArray(w * h * 4);
  data[(1 * w + 2) * 4 + 3] = 255; data[(3 * w + 1) * 4 + 3] = 255; data[(4 * w + 0) * 4 + 3] = 10;
  expect(worldAlphaBounds(data, w, h)).toEqual({ top: 1, foot: 3 });
  expect(worldAlphaBounds(new Uint8ClampedArray(w * h * 4), w, h)).toBeNull();
 });

 it("accepts an optional declared height in v3 packs and shows it in the review summary", () => {
  const base = { version: 1, artStatus: "prototype", movement: "quadruped", directions: { s: { idle: { frames: [{ src: PNG_256, durationMs: 400 }], loop: true } } } };
  expect(validateWorldHdCharacter({ ...base, height: "small" })?.height).toBe("small");
  expect(validateWorldHdCharacter({ ...base, height: "giant" })).toBeNull();
  const plain = validateWorldHdCharacter(base)!;
  expect(plain.height).toBeUndefined();
  expect(worldHdCoverage(plain).summary).toContain("in-room height: adult (default)");
  expect(worldHdCoverage(validateWorldHdCharacter({ ...base, height: "small" })!).summary).toContain("in-room height: small");
 });
});

describe("perspective is shared per room", () => {
 it("office rooms draw visitors at the same fixed size as their Pals; floor rooms keep perspective", async () => {
  const { worldActorDepthScale, worldDepthScale } = await import("@/lib/world-navigation");
  for (const theme of ["linux", "assistant", "devteam"] as const) expect(worldActorDepthScale(theme, 40)).toBe(1);
  expect(worldActorDepthScale("matrix", 40)).toBe(worldDepthScale(40));
  expect(worldActorDepthScale("horror", 40)).toBeLessThan(1);
 });
});

describe("smooth HD illustrated art stays smooth (owner direction 2026-11-07)", () => {
 it("only grid-aligned art marked crisp is drawn with nearest-neighbour pixels", () => {
  const css = readFileSync("src/styles.css", "utf8").replace(/\/\*[\s\S]*?\*\//g, "");
  const rules = [...css.matchAll(/([^{}]+)\{([^{}]*)\}/g)].map(m => ({ selector: m[1]!.trim(), body: m[2]! }));
  const hdPixelated = rules.filter(r => /image-rendering\s*:\s*pixelated/.test(r.body) && /world-pal-hd-art|world-custom-guest|world-guest-hd-pixels/.test(r.selector));
  // The generic built-in-guest rule is overridden for imported (custom) visitors below.
  for (const rule of hdPixelated) for (const part of rule.selector.split(",")) {
   if (part.trim() === ".world-guest-hd-pixels") continue;
   expect(part).toContain("world-hd-crisp");
  }
  expect(rules.some(r => r.selector === ".world-custom-guest .world-guest-hd-pixels" && /image-rendering\s*:\s*auto/.test(r.body))).toBe(true);
 });
 it("never snaps painted art to pixel multiples or enlarges it past the measured height", () => {
  for (const dpr of [1, 2, 3]) for (const phone of [false, true]) {
   const r = worldHdScale({ metrics: { grid: 1, top: 20, foot: 247 }, worldPixel: worldPixelSize(phone, dpr), devicePixelRatio: dpr });
   expect(r.crisp).toBe(false);
   expect(r.heightRatio).toBeCloseTo(1, 3);
   expect(r.size).toBeCloseTo(worldHumanHeight(worldPixelSize(phone, dpr)) * 256 / 228, 2);
  }
 });
});

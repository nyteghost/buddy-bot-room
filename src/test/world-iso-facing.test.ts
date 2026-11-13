import { describe, expect, it } from "vitest";
import { WORLD_HD_DIRECTIONS, type WorldHdCharacter, type WorldHdClip, type WorldHdDirection } from "@/lib/world-hd";
import { selectWorldHdClip } from "@/lib/world-hd-animation";
import { WORLD_ISO_FACING_ANGLES, WORLD_ISO_FACING_HOLD_MS, worldIsoFacingHoldStart, worldIsoFacingOf, worldIsoFacingStep, worldIsoGroundFacing } from "@/lib/world-iso-facing";
import { worldFlatProjection, worldIsoProjection } from "@/lib/world-iso-projection";

const iso = worldIsoProjection();
const O = { u: 5, v: 5 };
const toward = (du: number, dv: number) => worldIsoGroundFacing(iso, O, { u: O.u + du, v: O.v + dv });

describe("isometric facing", () => {
 it("uses the 2:1 floor-line angles, not even 45° slices", () => {
  expect(WORLD_ISO_FACING_ANGLES.e).toBe(0);
  expect(WORLD_ISO_FACING_ANGLES.s).toBe(90);
  expect(WORLD_ISO_FACING_ANGLES.se).toBeCloseTo(26.565, 3);
  expect(WORLD_ISO_FACING_ANGLES.sw).toBeCloseTo(153.435, 3);
  expect(WORLD_ISO_FACING_ANGLES.nw).toBeCloseTo(206.565, 3);
  expect(WORLD_ISO_FACING_ANGLES.ne).toBeCloseTo(333.435, 3);
 });

 it("maps walking along each ground axis to the diagonal facings", () => {
  expect(toward(1, 0)).toBe("se"); // +u runs down-right on screen
  expect(toward(0, 1)).toBe("sw"); // +v runs down-left
  expect(toward(-1, 0)).toBe("nw");
  expect(toward(0, -1)).toBe("ne");
 });

 it("maps the screen-aligned ground diagonals to the four cardinal facings", () => {
  expect(toward(1, 1)).toBe("s");   // straight down the screen, towards the viewer
  expect(toward(-1, -1)).toBe("n"); // straight up, away from the viewer
  expect(toward(1, -1)).toBe("e");
  expect(toward(-1, 1)).toBe("w");
 });

 it("covers all eight authored directions, each from its own sector", () => {
  const seen = new Set<WorldHdDirection>();
  for (let a = 0; a < 360; a += 1) seen.add(worldIsoFacingOf(Math.cos(a * Math.PI / 180), Math.sin(a * Math.PI / 180)));
  expect([...seen].sort()).toEqual([...WORLD_HD_DIRECTIONS].sort());
 });

 it("splits sectors half-way between neighbouring facing angles", () => {
  const at = (deg: number) => worldIsoFacingOf(Math.cos(deg * Math.PI / 180), Math.sin(deg * Math.PI / 180));
  expect(at(13)).toBe("e"); expect(at(14)).toBe("se");
  expect(at(58)).toBe("se"); expect(at(59)).toBe("s");
  expect(at(121)).toBe("s"); expect(at(122)).toBe("sw");
  expect(at(166)).toBe("sw"); expect(at(167)).toBe("w");
 });

 it("keeps the fallback when not moving or given bad input", () => {
  expect(worldIsoFacingOf(0, 0)).toBe("s");
  expect(worldIsoFacingOf(0, 0, "nw")).toBe("nw");
  expect(worldIsoFacingOf(Number.NaN, 1, "e")).toBe("e");
 });

 it("works through the flat projection too (screen percent movement)", () => {
  const flat = worldFlatProjection();
  expect(worldIsoGroundFacing(flat, { u: 50, v: 50 }, { u: 50, v: 60 })).toBe("s");
  expect(worldIsoGroundFacing(flat, { u: 50, v: 50 }, { u: 40, v: 50 })).toBe("w");
 });
});

describe("facing jitter guard", () => {
 it("switches only after the new facing is wanted for 120 ms", () => {
  let s = worldIsoFacingHoldStart("s", 0);
  s = worldIsoFacingStep(s, "se", 10);
  expect(s.shown).toBe("s");
  s = worldIsoFacingStep(s, "se", 10 + WORLD_ISO_FACING_HOLD_MS - 1);
  expect(s.shown).toBe("s");
  s = worldIsoFacingStep(s, "se", 10 + WORLD_ISO_FACING_HOLD_MS);
  expect(s.shown).toBe("se");
 });

 it("does not flicker on a path that wobbles across a sector boundary", () => {
  let s = worldIsoFacingHoldStart("s", 0), switches = 0, last = s.shown;
  for (let t = 0; t < 2000; t += 16) {
   s = worldIsoFacingStep(s, (t / 16) % 2 ? "se" : "s", t);
   if (s.shown !== last) { switches++; last = s.shown; }
  }
  expect(switches).toBe(0);
 });

 it("restarts the hold when the candidate changes, and can switch at once on arrival", () => {
  let s = worldIsoFacingHoldStart("s", 0);
  s = worldIsoFacingStep(s, "se", 0);
  s = worldIsoFacingStep(s, "e", 100);
  s = worldIsoFacingStep(s, "e", 150);
  expect(s.shown).toBe("s");
  s = worldIsoFacingStep(s, "e", 220);
  expect(s.shown).toBe("e");
  expect(worldIsoFacingStep(worldIsoFacingHoldStart("s"), "sw", 5, WORLD_ISO_FACING_HOLD_MS, true).shown).toBe("sw");
 });
});

describe("authored art is never mirrored (existing clip selection, unchanged)", () => {
 const clip = (name: string, frames = 6): WorldHdClip => ({ loop: true, frames: Array.from({ length: frames }, (_, i) => ({ src: `${name}-${i}`, durationMs: 120 })) });
 const southOnly: WorldHdCharacter = { version: 3, artStatus: "prototype", movement: "humanoid", directions: { s: { idle: clip("s-idle", 4), walk: clip("s-walk") } } };

 it("a south-only pack walks with its south clip in every facing", () => {
  for (const d of WORLD_HD_DIRECTIONS) {
   const pick = selectWorldHdClip(southOnly, d, "walk");
   expect(pick.direction).toBe("s");
   expect(pick.clip.frames[0]!.src).toBe("s-walk-0");
  }
 });

 it("west-side facings never borrow east art as a mirror", () => {
  const eastAndSouth: WorldHdCharacter = { ...southOnly, directions: { ...southOnly.directions, e: { idle: clip("e-idle", 1), walk: clip("e-walk") } } };
  const w = selectWorldHdClip(eastAndSouth, "w", "walk");
  expect(w.direction).not.toBe("e");
  expect(w.clip.frames[0]!.src.startsWith("e-")).toBe(false);
 });
});

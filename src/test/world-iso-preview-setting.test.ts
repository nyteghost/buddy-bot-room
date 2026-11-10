import { describe, expect, it } from "vitest";
import { WORLD_ROOM_APPEARANCE_DEFAULT, cleanWorldRoomAppearance, worldUsesIsoOffice, worldUsesHdOffice } from "@/lib/world-presentation";

const desktop = { width: 1440, coarse: false } as const;
const mobile = { width: 390, coarse: true } as const;

describe("Step 1b hidden preview selection (no UI wiring)", () => {
 it("leaves existing saved preference data unchanged in effect: missing flag is false", () => {
  const old = cleanWorldRoomAppearance({ look: "hd", hdOffice: true, synthetic: true });
  expect(old.isoOffice).not.toBe(true);
  expect(old.hdOffice).toBe(true);
  expect(old.synthetic).toBe(true);
  expect(WORLD_ROOM_APPEARANCE_DEFAULT.isoOffice).not.toBe(true);
  expect(worldUsesIsoOffice(old, "linux", desktop)).toBe(false);
  expect(worldUsesHdOffice(old, "linux", desktop)).toBe(true);
 });
 it("rejects malformed and merely truthy values", () => {
  for (const input of [null, 1, "true", { isoOffice: "true" }, { isoOffice: 1 }, { isoOffice: [] }]) {
   expect(cleanWorldRoomAppearance(input).isoOffice).not.toBe(true);
  }
 });
 it("requires explicit opt-in, HD look, HD Office and matching theme", () => {
  const on = cleanWorldRoomAppearance({ look: "hd", hdOffice: true, isoOffice: true });
  expect(worldUsesIsoOffice(on, "linux", desktop)).toBe(true);
  expect(worldUsesIsoOffice(on, "horror", desktop)).toBe(false);
  expect(worldUsesIsoOffice({ ...on, hdOffice: false }, "linux", desktop)).toBe(false);
  expect(worldUsesIsoOffice({ ...on, look: "pixel" }, "linux", desktop)).toBe(false);
  expect(worldUsesIsoOffice({ ...on, isoOffice: false }, "linux", desktop)).toBe(false);
 });
 it("never enables on phone widths, low-power or data-saver hints even with forced HD", () => {
  const on = cleanWorldRoomAppearance({ look: "hd", hdOffice: true, isoOffice: true });
  expect(worldUsesIsoOffice(on, "linux", mobile)).toBe(false);
  expect(worldUsesIsoOffice(on, "linux", { ...desktop, saveData: true })).toBe(false);
  expect(worldUsesIsoOffice(on, "linux", { ...desktop, lowPower: true })).toBe(false);
  expect(worldUsesIsoOffice(on, "linux", { ...desktop, width: 700 })).toBe(false);
 });
});

import { afterEach, describe, expect, it } from "vitest";
import {
 WORLD_ISO_PREFERENCE_DEFAULT, WORLD_ISO_PREFERENCE_KEY, cleanWorldIsoPreference, getWorldIsoPreference, setWorldIsoPreference, subscribeWorldIsoPreference, worldOfficeRoom,
} from "@/lib/world-iso-presentation";
import { WORLD_PRESENTATION_KEY, WORLD_ROOM_APPEARANCE_DEFAULT, cleanWorldRoomAppearance, getWorldRoomAppearance, setWorldRoomAppearance, worldUsesHdOffice, type WorldRoomAppearance } from "@/lib/world-presentation";

const desk = { width: 1440, coarse: false }, phone = { width: 390, coarse: true };
const appearance = (over: Partial<WorldRoomAppearance> = {}): WorldRoomAppearance => ({ look: "auto", hdOffice: false, synthetic: false, ...over });
/** Minimal localStorage stand-in so the storage functions can run in any test environment. */
function withStorage<T>(initial: Record<string, string>, run: (store: Map<string, string>) => T): T {
 const store = new Map(Object.entries(initial)), g = globalThis as unknown as { localStorage?: unknown }, had = "localStorage" in g, before = g.localStorage;
 Object.defineProperty(g, "localStorage", { configurable: true, writable: true, value: { getItem: (k: string) => store.get(k) ?? null, setItem: (k: string, v: string) => { store.set(k, String(v)); }, removeItem: (k: string) => { store.delete(k); } } });
 try { return run(store); } finally { if (had) Object.defineProperty(g, "localStorage", { configurable: true, writable: true, value: before }); else delete g.localStorage; }
}
afterEach(() => { try { setWorldIsoPreference({ isoOffice: false }); } catch { /* no storage in this environment */ } });

describe("isometric Office preference (Stage 1)", () => {
 it("is off by default and only the exact boolean true turns it on", () => {
  expect(WORLD_ISO_PREFERENCE_DEFAULT).toEqual({ isoOffice: false });
  expect(cleanWorldIsoPreference({ isoOffice: true })).toEqual({ isoOffice: true });
  for (const bad of [undefined, null, 0, 1, "true", "yes", [], [true], {}, { isoOffice: "true" }, { isoOffice: 1 }, { isoOffice: null }, { iso: true }, { hdOffice: true }])
   expect(cleanWorldIsoPreference(bad)).toEqual({ isoOffice: false });
 });

 it("reads missing, malformed or older saved settings as off", () => {
  for (const saved of [undefined, "", "not json", "null", "[]", "42", '"on"', '{"isoOffice":"true"}', '{"isoOffice":1}', '{"look":"hd","hdOffice":true,"synthetic":false}', '{"isoOffice":true'])
   withStorage(saved === undefined ? {} : { [WORLD_ISO_PREFERENCE_KEY]: saved }, () => expect(getWorldIsoPreference()).toEqual({ isoOffice: false }));
  withStorage({ [WORLD_ISO_PREFERENCE_KEY]: '{"isoOffice":true,"extra":7}' }, () => expect(getWorldIsoPreference()).toEqual({ isoOffice: true }));
 });

 it("survives storage that throws", () => {
  const g = globalThis as unknown as { localStorage?: unknown }, had = "localStorage" in g, before = g.localStorage;
  Object.defineProperty(g, "localStorage", { configurable: true, writable: true, value: { getItem() { throw new Error("denied"); }, setItem() { throw new Error("denied"); } } });
  try { expect(getWorldIsoPreference()).toEqual({ isoOffice: false }); expect(setWorldIsoPreference({ isoOffice: true })).toEqual({ isoOffice: false }); }
  finally { if (had) Object.defineProperty(g, "localStorage", { configurable: true, writable: true, value: before }); else delete g.localStorage; }
 });

 it("saves under its own key, notifies listeners, and never touches the Room Appearance record", () => {
  withStorage({ [WORLD_PRESENTATION_KEY]: '{"look":"hd","hdOffice":true,"synthetic":false}' }, store => {
   let calls = 0;
   const stop = subscribeWorldIsoPreference(() => { calls++; });
   expect(setWorldIsoPreference({ isoOffice: true })).toEqual({ isoOffice: true });
   expect(JSON.parse(store.get(WORLD_ISO_PREFERENCE_KEY)!)).toEqual({ isoOffice: true });
   expect(store.get(WORLD_PRESENTATION_KEY)).toBe('{"look":"hd","hdOffice":true,"synthetic":false}'); // byte-for-byte unchanged
   expect(getWorldRoomAppearance()).toEqual({ look: "hd", hdOffice: true, synthetic: false });
   expect(calls).toBe(1);
   // Saving Room Appearance does not clear or change the preview preference, and its shape is unchanged.
   setWorldRoomAppearance({ look: "pixel" });
   expect(JSON.parse(store.get(WORLD_PRESENTATION_KEY)!)).toEqual({ look: "pixel", hdOffice: true, synthetic: false });
   expect(getWorldIsoPreference()).toEqual({ isoOffice: true });
   stop();
   setWorldIsoPreference({ isoOffice: false });
   expect(calls).toBe(1);
   expect(JSON.parse(store.get(WORLD_ISO_PREFERENCE_KEY)!)).toEqual({ isoOffice: false });
  });
 });

 it("leaves the existing appearance defaults and cleaner exactly as they were", () => {
  expect(WORLD_ROOM_APPEARANCE_DEFAULT).toEqual({ look: "auto", hdOffice: false, synthetic: false });
  expect(cleanWorldRoomAppearance({ look: "hd", hdOffice: true, synthetic: true, isoOffice: true })).toEqual({ look: "hd", hdOffice: true, synthetic: true });
 });
});

describe("which Office room shows (selection and fallback)", () => {
 const on = { isoOffice: true }, off = { isoOffice: false };
 it("never selects the preview unless it is explicitly on", () => {
  for (const iso of [off, null, undefined, {} as { isoOffice: boolean }, { isoOffice: "true" as unknown as boolean }, { isoOffice: 1 as unknown as boolean }])
   for (const a of [appearance(), appearance({ hdOffice: true }), appearance({ look: "hd", hdOffice: true })])
    expect(worldOfficeRoom({ iso, appearance: a, theme: "linux", hints: desk })).toBe(a.hdOffice ? "hd" : "current");
 });

 it("with the preview off, matches today's rule for every combination", () => {
  for (const look of ["auto", "hd", "pixel"] as const) for (const hdOffice of [false, true]) for (const theme of ["linux", "matrix", "horror"]) for (const hints of [desk, phone]) {
   const a = appearance({ look, hdOffice });
   expect(worldOfficeRoom({ iso: off, appearance: a, theme, hints })).toBe(worldUsesHdOffice(a, theme, hints) ? "hd" : "current");
  }
 });

 it("shows the preview only for the Office theme with an HD look, and not in Classic", () => {
  expect(worldOfficeRoom({ iso: on, appearance: appearance(), theme: "linux", hints: desk })).toBe("iso");
  expect(worldOfficeRoom({ iso: on, appearance: appearance({ look: "hd" }), theme: "linux", hints: phone })).toBe("iso");   // HD chosen by hand on a phone
  expect(worldOfficeRoom({ iso: on, appearance: appearance(), theme: "linux", hints: phone })).toBe("current");             // phones resolve to Pixel
  expect(worldOfficeRoom({ iso: on, appearance: appearance({ look: "pixel" }), theme: "linux", hints: desk })).toBe("current");
  expect(worldOfficeRoom({ iso: on, appearance: appearance(), theme: "linux", hints: { ...desk, lowPower: true } })).toBe("current");
  expect(worldOfficeRoom({ iso: on, appearance: appearance(), theme: "linux", hints: { ...desk, saveData: true } })).toBe("current");
  expect(worldOfficeRoom({ iso: on, appearance: appearance({ hdOffice: true }), theme: "matrix", hints: desk })).toBe("current");
  expect(worldOfficeRoom({ iso: on, appearance: appearance({ hdOffice: true }), theme: "linux", hints: desk, classic: true })).toBe("current");
 });

 it("falls back safely when the preview fails", () => {
  expect(worldOfficeRoom({ iso: on, appearance: appearance({ hdOffice: true }), theme: "linux", hints: desk, isoFailed: true })).toBe("hd");
  expect(worldOfficeRoom({ iso: on, appearance: appearance(), theme: "linux", hints: desk, isoFailed: true })).toBe("current");
 });

 it("does not change the HD / Pixel / Classic choice itself", () => {
  const a = appearance({ look: "pixel", hdOffice: true });
  worldOfficeRoom({ iso: on, appearance: a, theme: "linux", hints: desk });
  expect(a).toEqual({ look: "pixel", hdOffice: true, synthetic: false });
 });
});

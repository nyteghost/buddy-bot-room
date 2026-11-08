import { afterEach, describe, expect, it } from "vitest";
import { act, cleanup, render, screen } from "@testing-library/react";
import { OfficePal } from "@/components/office-pal";
import { WorldHdOffice } from "@/components/world-hd-office";
import { starterCustomCharacter, MAX_ACTIVE_VISITORS, type WorldCustomCharacter } from "@/lib/world-custom-packs";
import { worldBuiltInVisitor, worldHdVisitors } from "@/lib/world-hd-visitors";
import { setWorldRoomAppearance } from "@/lib/world-presentation";
import {
 WORLD_PAL_PIXEL_SKINS_KEY, WORLD_PAL_SKINS_KEY, assignWorldPalLook, cleanWorldPalLooks, clearWorldPalSkins, forgetWorldLookCharacter,
 getWorldPalPixelSkins, getWorldPalSkins, publishWorldSkinCharacters, setWorldPalPixelSkin, setWorldPalSkin, withoutWorldLookCharacter,
} from "@/lib/world-pal-skins";

const idleOnly = (id: string, name: string, src: string): WorldCustomCharacter => ({ ...starterCustomCharacter(), id, name,
 hd3: { version: 1, artStatus: "prototype", movement: "humanoid", height: "adult", directions: { s: { idle: { frames: [{ src, durationMs: 1200 }], loop: true } } } } });
const HD = idleOnly("user-novahd256", "Nova - Desktop HD", "data:image/png;base64,hd");
const PX = idleOnly("user-novapixel01", "Nova - Mobile Pixel", "data:image/png;base64,px");
const custom = (id: string, name: string): WorldCustomCharacter => ({ ...starterCustomCharacter(), id, name });
const lookSrc = (c: HTMLElement) => c.querySelector('img[alt$=" look"]')?.getAttribute("src") ?? null;
const otherTab = (key: string, value: object) => { localStorage.setItem(key, JSON.stringify(value)); window.dispatchEvent(new StorageEvent("storage", { key })); };

afterEach(() => { cleanup(); act(() => { clearWorldPalSkins(); publishWorldSkinCharacters([]); setWorldRoomAppearance({ look: "auto", hdOffice: false, synthetic: false }); }); });

describe("HD office visitors (P1: built-in guests must not disappear)", () => {
 it("keeps enabled built-in guests, in enabled order, with custom ones, at most six, never twice", () => {
  const a = custom("user-aaaaaaaa", "Robo A"), b = custom("user-bbbbbbbb", "Nova look");
  const list = worldHdVisitors(["green-jacket", "moon-mage", "user-aaaaaaaa", "moon-mage", "user-bbbbbbbb", "deleted-pack", "goku", "homer", "tiny-dragon", "pixel-robot"], [a, b], new Set([b.id]));
  expect(list.map(v => v.id)).toEqual(["green-jacket", "moon-mage", "user-aaaaaaaa", "goku", "homer", "tiny-dragon"]);
  expect(list).toHaveLength(MAX_ACTIVE_VISITORS);
  expect(list[0]).toMatchObject({ name: "Green Jacket Guy", builtIn: true });
  expect(worldBuiltInVisitor("goku")).toBe(worldBuiltInVisitor("goku")); // stable object for React and the crowd
  expect(worldHdVisitors([], [a], new Set())).toEqual([]);
 });
 it("draws built-in guests in the HD office with their own pixel art and honest descriptions", () => {
  const visitors = worldHdVisitors(["green-jacket", "moon-mage"], [], new Set());
  const { container } = render(<WorldHdOffice pals={[{ id: "nova", name: "Nova", enabled: true, real: null }]} visitors={visitors} visible playful={false} paused={false} synthetic={false} />);
  for (const id of ["green-jacket", "moon-mage"]) expect(container.querySelector(`.hd-actor[data-actor="custom:${id}"]`)?.getAttribute("data-art")).toBe("pixels");
  const who = screen.getByRole("list", { name: "Who is in the room" }).textContent ?? "";
  expect(who).toContain("Green Jacket Guy");
  expect(who).toContain("Moon Mage");
  expect(who).not.toMatch(/real activity.*Moon Mage|Moon Mage[^|]*real activity/);
 });
});

describe("appearance mapping reliability (P2)", () => {
 it("a character dresses one Pal only, across both Desktop HD and Mobile Pixel", () => {
  expect(assignWorldPalLook({ nova: HD.id }, {}, "pixel", "byte", HD.id)).toEqual({ hd: {}, pixel: { byte: HD.id } });
  expect(assignWorldPalLook({ nova: HD.id }, {}, "pixel", "nova", HD.id)).toEqual({ hd: { nova: HD.id }, pixel: { nova: HD.id } });
  expect(cleanWorldPalLooks({ nova: HD.id }, { byte: HD.id, nova: PX.id })).toEqual({ hd: { nova: HD.id }, pixel: { nova: PX.id } });
  act(() => { setWorldPalSkin("nova", HD.id); setWorldPalPixelSkin("byte", HD.id); });
  expect(getWorldPalSkins()).toEqual({});
  expect(getWorldPalPixelSkins()).toEqual({ byte: HD.id });
 });
 it("follows look changes made in another tab", () => {
  act(() => { publishWorldSkinCharacters([HD, PX]); setWorldRoomAppearance({ look: "pixel" }); });
  const pal = render(<OfficePal id="nova" index={0} mode="matrix" active={false} enabled world playful={false} />);
  expect(lookSrc(pal.container)).toBeNull();
  act(() => otherTab(WORLD_PAL_PIXEL_SKINS_KEY, { nova: PX.id }));
  expect(lookSrc(pal.container)).toBe("data:image/png;base64,px");
  act(() => otherTab(WORLD_PAL_SKINS_KEY, { nova: HD.id }));
  act(() => setWorldRoomAppearance({ look: "hd" }));
  expect(lookSrc(pal.container)).toBe("data:image/png;base64,hd");
  act(() => { localStorage.clear(); window.dispatchEvent(new StorageEvent("storage", { key: null })); });
  expect(lookSrc(pal.container)).toBeNull(); // other tab restored the original Nova
 });
 it("falls back when an imported appearance is removed, and forgets it on delete", () => {
  act(() => { publishWorldSkinCharacters([HD, PX]); setWorldPalSkin("nova", HD.id); setWorldPalPixelSkin("nova", PX.id); setWorldRoomAppearance({ look: "hd" }); });
  const pal = render(<OfficePal id="nova" index={0} mode="matrix" active={false} enabled world playful={false} />);
  expect(lookSrc(pal.container)).toBe("data:image/png;base64,hd");
  act(() => publishWorldSkinCharacters([PX])); // HD art removed (or not loaded yet): use the Pixel look
  expect(lookSrc(pal.container)).toBe("data:image/png;base64,px");
  act(() => forgetWorldLookCharacter(HD.id));
  expect(getWorldPalSkins()).toEqual({});
  expect(getWorldPalPixelSkins()).toEqual({ nova: PX.id });
  act(() => publishWorldSkinCharacters([])); // both gone: the original Nova
  expect(lookSrc(pal.container)).toBeNull();
  expect(withoutWorldLookCharacter({ nova: PX.id }, "user-unrelated01")).toEqual({ nova: PX.id });
 });
 it("switches HD → Pixel → original and back without touching other saved data", () => {
  const other = { "pixel-pals-memory-v1": '{"nova":["likes tea"]}', "pixel-pals-tasks-v1": '[{"pal":"nova"}]', "pixel-pals-permissions-v1": '{"nova":["read"]}' };
  for (const [k, v] of Object.entries(other)) localStorage.setItem(k, v);
  act(() => { publishWorldSkinCharacters([HD, PX]); setWorldPalSkin("nova", HD.id); setWorldPalPixelSkin("nova", PX.id); });
  const pal = render(<OfficePal id="nova" index={0} mode="linux" active={false} enabled world playful={false} />);
  for (const [look, src] of [["hd", "hd"], ["pixel", "px"], ["hd", "hd"]] as const) {
   act(() => setWorldRoomAppearance({ look }));
   expect(lookSrc(pal.container)).toBe("data:image/png;base64," + src);
  }
  act(() => clearWorldPalSkins());
  expect(lookSrc(pal.container)).toBeNull();
  act(() => { setWorldPalSkin("nova", HD.id); setWorldRoomAppearance({ look: "hd" }); });
  expect(lookSrc(pal.container)).toBe("data:image/png;base64,hd");
  for (const [k, v] of Object.entries(other)) expect(localStorage.getItem(k)).toBe(v);
 });
});

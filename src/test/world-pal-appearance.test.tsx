import { afterEach, describe, expect, it } from "vitest";
import { act, cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { OfficePal } from "@/components/office-pal";
import { WorldRoomAppearance } from "@/components/world-room-appearance";
import { WorldHdOffice } from "@/components/world-hd-office";
import { starterCustomCharacter, type WorldCustomCharacter } from "@/lib/world-custom-packs";
import { setWorldRoomAppearance } from "@/lib/world-presentation";
import { worldLookArtNote } from "@/lib/world-hd-animation";
import { agentName } from "@/lib/agents";
import {
 WORLD_PAL_PIXEL_SKINS_KEY, WORLD_PAL_SKINS_KEY, clearWorldPalSkins, getWorldPalPixelSkins, getWorldPalSkins, publishWorldSkinCharacters,
 setWorldPalPixelSkin, setWorldPalSkin, worldPalAppearances, worldPalLookIds,
} from "@/lib/world-pal-skins";

// Synthetic stand-ins with the same shape as the two Nova v3 idle-only packs (no private art in tests).
const idleOnly = (id: string, name: string, version: number, src: string): WorldCustomCharacter => ({ ...starterCustomCharacter(), id, name,
 hd3: { version, artStatus: "prototype", movement: "humanoid", height: "adult", directions: { s: { idle: { frames: [{ src, durationMs: 1200 }], loop: true } } } } });
const HD = idleOnly("user-novahd256", "Nova - Desktop HD", 3, "data:image/png;base64,hd");
const PX = idleOnly("user-novapixel01", "Nova - Mobile Pixel", 1, "data:image/png;base64,px");

afterEach(() => { cleanup(); act(() => { clearWorldPalSkins(); publishWorldSkinCharacters([]); setWorldRoomAppearance({ look: "auto", hdOffice: false, synthetic: false }); }); });

describe("one Nova, two appearances (cosmetic only)", () => {
 it("lists each Pal's Desktop HD and Mobile Pixel looks and which one this device shows", () => {
  expect(worldPalAppearances({ nova: HD.id }, { nova: PX.id }, [HD, PX])).toEqual([{ pal: "nova", hd: HD, pixel: PX }]);
  expect(worldPalAppearances({ nova: HD.id }, {}, [])).toEqual([]); // removed art → original Nova
  expect([...worldPalLookIds({ nova: HD.id }, { nova: PX.id })].sort()).toEqual([HD.id, PX.id].sort());
 });
 it("describes a single front idle frame honestly", () => {
  expect(worldLookArtNote(HD)).toMatch(/front idle only .*not animated/);
 });
 it("switches look with the device presentation without touching identity, chats, memories, tasks or permissions", () => {
  const unrelated = { "pixel-pals-memory-v1": '{"nova":["likes tea"]}', "pixel-pals-chat-v1": '[{"agentId":"nova","text":"hi"}]', "pixel-pals-tasks-v1": '[{"pal":"nova"}]', "pixel-pals-permissions-v1": '{"nova":["read"]}' };
  for (const [k, v] of Object.entries(unrelated)) localStorage.setItem(k, v);
  const name = agentName("nova", false);
  act(() => { publishWorldSkinCharacters([HD, PX]); setWorldPalSkin("nova", HD.id); setWorldPalPixelSkin("nova", PX.id); setWorldRoomAppearance({ look: "hd" }); });
  const pal = render(<OfficePal id="nova" index={0} mode="matrix" active={false} enabled world playful={false} />);
  expect(pal.container.querySelector('img[alt$=" look"]')?.getAttribute("src")).toBe(HD.hd3!.directions.s!.idle!.frames[0]!.src);
  act(() => setWorldRoomAppearance({ look: "pixel" }));
  expect(pal.container.querySelector('img[alt$=" look"]')?.getAttribute("src")).toBe(PX.hd3!.directions.s!.idle!.frames[0]!.src);
  expect(pal.container.querySelector('img[alt$=" look"]')?.getAttribute("alt")).toContain("Nova");
  render(<WorldRoomAppearance />);
  const row = within(screen.getByRole("group", { name: "Pal appearances" })).getByText(/Desktop HD — Nova - Desktop HD/).closest("li")!;
  expect(row.getAttribute("data-showing")).toBe("pixel");
  expect(row.textContent).toContain("Mobile Pixel — Nova - Mobile Pixel");
  fireEvent.click(screen.getByRole("radio", { name: "HD" }));
  expect(screen.getByRole("group", { name: "Pal appearances" }).querySelector("li")!.getAttribute("data-showing")).toBe("hd");
  fireEvent.click(screen.getByRole("button", { name: "Restore Nova's original look" }));
  expect(getWorldPalSkins()).toEqual({});
  expect(getWorldPalPixelSkins()).toEqual({});
  expect(JSON.parse(localStorage.getItem(WORLD_PAL_SKINS_KEY)!)).toEqual({});
  expect(JSON.parse(localStorage.getItem(WORLD_PAL_PIXEL_SKINS_KEY)!)).toEqual({});
  expect(pal.container.querySelector('img[alt$=" look"]')).toBeNull(); // original native Nova sprite again
  for (const [k, v] of Object.entries(unrelated)) expect(localStorage.getItem(k)).toBe(v);
  expect(agentName("nova", false)).toBe(name);
 });
 it("falls back to the other look when one presentation has none", () => {
  act(() => { publishWorldSkinCharacters([HD]); setWorldPalSkin("nova", HD.id); setWorldRoomAppearance({ look: "pixel" }); });
  const pal = render(<OfficePal id="nova" index={0} mode="matrix" active={false} enabled world playful={false} />);
  expect(pal.container.querySelector('img[alt$=" look"]')?.getAttribute("src")).toBe(HD.hd3!.directions.s!.idle!.frames[0]!.src);
 });
 it("shows Nova's HD look in the HD office with an honest art note", () => {
  act(() => { publishWorldSkinCharacters([HD, PX]); setWorldPalSkin("nova", HD.id); setWorldPalPixelSkin("nova", PX.id); });
  render(<WorldHdOffice pals={[{ id: "nova", name: "Nova", enabled: true, real: null }]} visitors={[]} visible playful={false} paused={false} synthetic={false} />);
  const actor = document.querySelector('.hd-actor[data-actor="pal:nova"]')!;
  expect(actor.getAttribute("data-art")).toBe("hd");
  expect(screen.getByRole("list", { name: "Who is in the room" }).textContent).toMatch(/front idle only/);
 });
});

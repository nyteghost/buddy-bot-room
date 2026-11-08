import { useSyncExternalStore } from "react";
import type { WorldCustomCharacter } from "./world-custom-packs";

/**
 * Opt-in HD256 "looks" for the original Pals in Living World. Purely visual and reversible:
 * a mapping from a Pal's id to an imported HD character's id, kept in this browser only.
 * The Pal's name, prompts, memory, voice, tasks and permissions never change, Classic mode
 * ignores it, and a missing or removed character falls back to the native sprite.
 *
 * Two independent mappings per device: the HD look (Living Universe HD) and the Pixel look (Living
 * Universe Pixel / the current Living World). Each presentation falls back to the other look, then to
 * the native sprite, so a Pal is never invisible and is always the same Pal.
 */
export const WORLD_PAL_SKINS_KEY = "pixel-pals-pal-skins-v1";
export const WORLD_PAL_PIXEL_SKINS_KEY = "pixel-pals-pal-skins-pixel-v1";
export const WORLD_SKIN_PALS = ["nova", "byte", "sage", "pip", "echo", "rune", "claude", "saiyan", "mimic"] as const;
export type WorldPalSkins = Readonly<Record<string, string>>;
const characterId = /^user-[a-z0-9]{8,40}$/;

/** Keep only known Pals mapped to well-formed character ids (one Pal per character). */
export function cleanWorldPalSkins(raw: unknown): WorldPalSkins {
 if (!raw || typeof raw !== "object" || Array.isArray(raw)) return {};
 const out: Record<string, string> = {}, used = new Set<string>();
 for (const pal of WORLD_SKIN_PALS) {
  const value = (raw as Record<string, unknown>)[pal];
  if (typeof value === "string" && characterId.test(value) && !used.has(value)) { out[pal] = value; used.add(value); }
 }
 return out;
}
/** Pure: the HD character a Pal should look like, or undefined for the native sprite. */
export function worldPalSkinCharacter(skins: WorldPalSkins, characters: readonly WorldCustomCharacter[], pal: string): WorldCustomCharacter | undefined {
 const id = skins[pal];
 const found = id ? characters.find(character => character.id === id) : undefined;
 return found && (found.hd3 || found.hd) ? found : undefined;
}
/** Pure: assign (or clear with null) a look; a character can dress only one Pal at a time. */
export function withWorldPalSkin(skins: WorldPalSkins, pal: string, id: string | null): WorldPalSkins {
 if (!(WORLD_SKIN_PALS as readonly string[]).includes(pal)) return skins;
 const next: Record<string, string> = {};
 for (const [key, value] of Object.entries(skins)) if (key !== pal && value !== id) next[key] = value;
 if (id && characterId.test(id)) next[pal] = id;
 return cleanWorldPalSkins(next);
}

/**
 * Pure: assign (or clear, id null) one Pal's look in one presentation. A character dresses at most one Pal:
 * giving it to this Pal removes it from any other Pal in BOTH presentations (it may still be this Pal's
 * look in the other presentation).
 */
export function assignWorldPalLook(hd: WorldPalSkins, pixel: WorldPalSkins, style: "hd" | "pixel", pal: string, id: string | null): { hd: WorldPalSkins; pixel: WorldPalSkins } {
 if (!(WORLD_SKIN_PALS as readonly string[]).includes(pal)) return { hd, pixel };
 const release = (skins: WorldPalSkins): WorldPalSkins => id ? Object.fromEntries(Object.entries(skins).filter(([key, value]) => key === pal || value !== id)) : skins;
 const nextHd = style === "hd" ? withWorldPalSkin(hd, pal, id) : cleanWorldPalSkins(release(hd));
 const nextPixel = style === "pixel" ? withWorldPalSkin(pixel, pal, id) : cleanWorldPalSkins(release(pixel));
 return { hd: nextHd, pixel: nextPixel };
}
/** Pure: repair stored maps so a character dresses one Pal only (the HD map wins a conflict). */
export function cleanWorldPalLooks(hd: unknown, pixel: unknown): { hd: WorldPalSkins; pixel: WorldPalSkins } {
 const h = cleanWorldPalSkins(hd), p = cleanWorldPalSkins(pixel);
 const owner = new Map(Object.entries(h).map(([pal, id]) => [id, pal]));
 return { hd: h, pixel: cleanWorldPalSkins(Object.fromEntries(Object.entries(p).filter(([pal, id]) => (owner.get(id) ?? pal) === pal))) };
}
/** Pure: forget a deleted character in both maps (its Pal falls back to the other look, then the original). */
export function withoutWorldLookCharacter(skins: WorldPalSkins, id: string): WorldPalSkins {
 return Object.values(skins).includes(id) ? cleanWorldPalSkins(Object.fromEntries(Object.entries(skins).filter(([, value]) => value !== id))) : skins;
}
/** Pure: the look a Pal uses in a presentation (its own look first, then the other one). */
export function worldPalLookCharacter(presentation: "hd" | "pixel", hd: WorldPalSkins, pixel: WorldPalSkins, list: readonly WorldCustomCharacter[], pal: string): WorldCustomCharacter | undefined {
 const own = worldPalSkinCharacter(presentation === "hd" ? hd : pixel, list, pal);
 return own ?? worldPalSkinCharacter(presentation === "hd" ? pixel : hd, list, pal);
}

/** One Pal, two appearances: which character dresses a Pal in each presentation (cosmetic only). */
export type WorldPalAppearance = { pal: string; hd?: WorldCustomCharacter; pixel?: WorldCustomCharacter };
/** Pure: every Pal with at least one installed look, in roster order. Missing characters are left out (native fallback). */
export function worldPalAppearances(hd: WorldPalSkins, pixel: WorldPalSkins, list: readonly WorldCustomCharacter[]): WorldPalAppearance[] {
 const out: WorldPalAppearance[] = [];
 for (const pal of WORLD_SKIN_PALS) {
  const h = worldPalSkinCharacter(hd, list, pal), p = worldPalSkinCharacter(pixel, list, pal);
  if (h || p) out.push({ pal, ...(h ? { hd: h } : {}), ...(p ? { pixel: p } : {}) });
 }
 return out;
}
/** Pure: character ids used as a Pal's look (they are drawn as that Pal, never as a second visitor). */
export function worldPalLookIds(hd: WorldPalSkins, pixel: WorldPalSkins): ReadonlySet<string> {
 return new Set([...Object.values(hd), ...Object.values(pixel)]);
}

const EMPTY: WorldPalSkins = Object.freeze({});
let skins: WorldPalSkins = EMPTY;
let pixelSkins: WorldPalSkins = EMPTY;
let characters: readonly WorldCustomCharacter[] = [];
let loaded = false;
const listeners = new Set<() => void>();
const emit = () => listeners.forEach(listener => listener());
const readJson = (key: string): unknown => { try { return JSON.parse(localStorage.getItem(key) ?? "{}"); } catch { return {}; } };
/** Keep the previous object when nothing changed, so React does not re-render for an unrelated storage event. */
const same = (a: WorldPalSkins, b: WorldPalSkins) => JSON.stringify(a) === JSON.stringify(b);
function load(force = false) {
 if (loaded && !force) return;
 loaded = true;
 const next = cleanWorldPalLooks(readJson(WORLD_PAL_SKINS_KEY), readJson(WORLD_PAL_PIXEL_SKINS_KEY));
 if (!same(skins, next.hd)) skins = next.hd;
 if (!same(pixelSkins, next.pixel)) pixelSkins = next.pixel;
}
function save() {
 try { localStorage.setItem(WORLD_PAL_SKINS_KEY, JSON.stringify(skins)); } catch { /* optional storage */ }
 try { localStorage.setItem(WORLD_PAL_PIXEL_SKINS_KEY, JSON.stringify(pixelSkins)); } catch { /* optional storage */ }
}
export function getWorldPalSkins(): WorldPalSkins { load(); return skins; }
export function getWorldPalPixelSkins(): WorldPalSkins { load(); return pixelSkins; }
function assign(style: "hd" | "pixel", pal: string, id: string | null) { load(true); const next = assignWorldPalLook(skins, pixelSkins, style, pal, id); skins = next.hd; pixelSkins = next.pixel; save(); emit(); }
export function setWorldPalSkin(pal: string, id: string | null): void { assign("hd", pal, id); }
export function setWorldPalPixelSkin(pal: string, id: string | null): void { assign("pixel", pal, id); }
/** A character was removed from the library: no Pal keeps pointing at it. */
export function forgetWorldLookCharacter(id: string): void { load(true); const hd = withoutWorldLookCharacter(skins, id), px = withoutWorldLookCharacter(pixelSkins, id); if (hd !== skins || px !== pixelSkins) { skins = hd; pixelSkins = px; save(); emit(); } }
/** Restore one Pal's original look in both presentations. */
export function clearWorldPalLook(pal: string): void { load(true); skins = withWorldPalSkin(skins, pal, null); pixelSkins = withWorldPalSkin(pixelSkins, pal, null); save(); emit(); }
/** One-click revert: every Pal back to its native look (both HD and Pixel looks). */
export function clearWorldPalSkins(): void { load(); skins = {}; pixelSkins = {}; save(); emit(); }
/** The Character Library shares the installed characters so Pals can find their look. */
export function publishWorldSkinCharacters(next: readonly WorldCustomCharacter[]): void { if (next !== characters) { characters = next; emit(); } }
// Other tabs and windows: follow their look changes (the storage event fires only in the *other* tabs).
const onStorage = (event: StorageEvent) => {
 if (event.key !== null && event.key !== WORLD_PAL_SKINS_KEY && event.key !== WORLD_PAL_PIXEL_SKINS_KEY) return;
 const before = [skins, pixelSkins];
 load(true);
 if (before[0] !== skins || before[1] !== pixelSkins) emit();
};
const subscribe = (listener: () => void) => {
 if (!listeners.size && typeof window !== "undefined") window.addEventListener("storage", onStorage);
 listeners.add(listener);
 return () => { listeners.delete(listener); if (!listeners.size && typeof window !== "undefined") window.removeEventListener("storage", onStorage); };
};
export function useWorldPalSkins(): WorldPalSkins { return useSyncExternalStore(subscribe, getWorldPalSkins, () => EMPTY); }
export function useWorldPalSkin(pal: string): WorldCustomCharacter | undefined {
 const current = useWorldPalSkins();
 const list = useSyncExternalStore(subscribe, () => characters, () => characters);
 return worldPalSkinCharacter(current, list, pal);
}
export function useWorldPalPixelSkins(): WorldPalSkins { return useSyncExternalStore(subscribe, getWorldPalPixelSkins, () => EMPTY); }
/** The look a Pal shows in a presentation (HD world: HD look first; Pixel / Living World: Pixel look first). */
export function useWorldPalLook(pal: string, presentation: "hd" | "pixel"): WorldCustomCharacter | undefined {
 const hd = useWorldPalSkins(), pixel = useWorldPalPixelSkins();
 const list = useSyncExternalStore(subscribe, () => characters, () => characters);
 return worldPalLookCharacter(presentation, hd, pixel, list, pal);
}
/** Installed characters as published by the Character Library (used to resolve looks). */
export function useWorldSkinCharacters(): readonly WorldCustomCharacter[] { return useSyncExternalStore(subscribe, () => characters, () => characters); }
/** Character ids currently used as Pal looks (stable while the mappings do not change). */
let lookIdsCache: { hd: WorldPalSkins; pixel: WorldPalSkins; ids: ReadonlySet<string> } | null = null;
export function useWorldPalLookIds(): ReadonlySet<string> {
 const hd = useWorldPalSkins(), pixel = useWorldPalPixelSkins();
 if (!lookIdsCache || lookIdsCache.hd !== hd || lookIdsCache.pixel !== pixel) lookIdsCache = { hd, pixel, ids: worldPalLookIds(hd, pixel) };
 return lookIdsCache.ids;
}

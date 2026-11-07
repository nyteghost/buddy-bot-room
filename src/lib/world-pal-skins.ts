import { useSyncExternalStore } from "react";
import type { WorldCustomCharacter } from "./world-custom-packs";

/**
 * Opt-in HD256 "looks" for the original Pals in Living World. Purely visual and reversible:
 * a mapping from a Pal's id to an imported HD character's id, kept in this browser only.
 * The Pal's name, prompts, memory, voice, tasks and permissions never change, Classic mode
 * ignores it, and a missing or removed character falls back to the native sprite.
 */
export const WORLD_PAL_SKINS_KEY = "pixel-pals-pal-skins-v1";
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

const EMPTY: WorldPalSkins = Object.freeze({});
let skins: WorldPalSkins = EMPTY;
let characters: readonly WorldCustomCharacter[] = [];
let loaded = false;
const listeners = new Set<() => void>();
const emit = () => listeners.forEach(listener => listener());
function load() {
 if (loaded) return;
 loaded = true;
 try { skins = cleanWorldPalSkins(JSON.parse(localStorage.getItem(WORLD_PAL_SKINS_KEY) ?? "{}")); } catch { skins = {}; }
}
function save() { try { localStorage.setItem(WORLD_PAL_SKINS_KEY, JSON.stringify(skins)); } catch { /* optional storage */ } }
export function getWorldPalSkins(): WorldPalSkins { load(); return skins; }
export function setWorldPalSkin(pal: string, id: string | null): void { load(); skins = withWorldPalSkin(skins, pal, id); save(); emit(); }
/** One-click revert: every Pal back to its native look. */
export function clearWorldPalSkins(): void { load(); skins = {}; save(); emit(); }
/** The Character Library shares the installed characters so Pals can find their look. */
export function publishWorldSkinCharacters(next: readonly WorldCustomCharacter[]): void { if (next !== characters) { characters = next; emit(); } }
const subscribe = (listener: () => void) => { listeners.add(listener); return () => listeners.delete(listener); };
export function useWorldPalSkins(): WorldPalSkins { return useSyncExternalStore(subscribe, getWorldPalSkins, () => EMPTY); }
export function useWorldPalSkin(pal: string): WorldCustomCharacter | undefined {
 const current = useWorldPalSkins();
 const list = useSyncExternalStore(subscribe, () => characters, () => characters);
 return worldPalSkinCharacter(current, list, pal);
}

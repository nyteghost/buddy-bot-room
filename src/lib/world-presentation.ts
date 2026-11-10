/**
 * Living Universe presentation choice (planning groundwork — not wired into the app yet).
 *
 * One app, one saved state: HD (desktop, detailed 256×256 art, larger camera world) and Pixel (mobile,
 * authored retro mini-sprites, lighter rooms) are presentations of the same Pals, memories, permissions
 * and data. The automatic default follows the device; the user's manual choice is stored per device and
 * always wins. Classic mode is a separate, existing room style and is unaffected.
 */
export type WorldPresentation = "hd" | "pixel";
export type WorldPresentationChoice = WorldPresentation | "auto";
export type WorldDeviceHints = Readonly<{
 /** Viewport width in CSS px. */ width: number;
 /** Primary pointer is coarse (touch). */ coarse: boolean;
 /** Data saver / low-power preference. */ saveData?: boolean;
 lowPower?: boolean;
}>;
export const WORLD_PRESENTATION_KEY = "pixel-pals-presentation-v1";
/** Below this width a phone-sized room is assumed. */
export const WORLD_PIXEL_MAX_WIDTH = 700;

/** Device default: phones and data-saving/low-power devices get Pixel; everything else HD. */
export function worldPresentationDefault(hints: WorldDeviceHints): WorldPresentation {
 if (hints.saveData || hints.lowPower) return "pixel";
 if (hints.width <= WORLD_PIXEL_MAX_WIDTH) return "pixel";
 // A large touch screen (tablet) still gets HD; a narrow window on a desktop gets Pixel by width above.
 return "hd";
}
/** The user's explicit choice wins; "auto" (or nothing saved) uses the device default. */
export function worldPresentation(choice: WorldPresentationChoice | null | undefined, hints: WorldDeviceHints): WorldPresentation {
 return choice === "hd" || choice === "pixel" ? choice : worldPresentationDefault(hints);
}
export function cleanWorldPresentationChoice(value: unknown): WorldPresentationChoice {
 return value === "hd" || value === "pixel" ? value : "auto";
}
/**
 * Which art a character uses in a presentation, with explicit fallbacks so nothing ever disappears:
 * HD → approved HD art, else the authored mini-sprite enlarged crisply, else the native 32px sprite.
 * Pixel → authored mini-sprite, else the native 32px sprite, else HD art downsampled (marked as a fallback,
 * never treated as production pixel art).
 */
export type WorldArtSource = "hd" | "mini" | "native" | "hd-downsampled";
export function worldArtSource(presentation: WorldPresentation, has: Readonly<{ hd: boolean; mini: boolean; native: boolean }>): WorldArtSource {
 if (presentation === "hd") return has.hd ? "hd" : has.mini ? "mini" : "native";
 return has.mini ? "mini" : has.native ? "native" : has.hd ? "hd-downsampled" : "native";
}

/** Per-device Room Appearance preferences (never stored with Pal identity, memories or server data). */
export type WorldRoomAppearance = Readonly<{
 /** Auto / HD / Pixel. */ look: WorldPresentationChoice;
 /** Feature flag: use the Living Universe HD office when the look resolves to HD (preview). */ hdOffice: boolean;
 /** Show synthetic HD placeholder bodies for Pals without approved HD art (preview of HD scale). */ synthetic: boolean;
 /** Hidden Stage 1b iso Office preview, never auto-enabled or selected on phones. */
 isoOffice: boolean;
}>;
export const WORLD_ROOM_APPEARANCE_DEFAULT: WorldRoomAppearance = Object.freeze({ look: "auto", hdOffice: false, synthetic: false, isoOffice: false });
export function cleanWorldRoomAppearance(value: unknown): WorldRoomAppearance {
 const v = value && typeof value === "object" ? value as Record<string, unknown> : {};
 return { look: cleanWorldPresentationChoice(v["look"]), hdOffice: v["hdOffice"] === true, synthetic: v["synthetic"] === true, isoOffice: v["isoOffice"] === true };
}
type Listener = () => void;
const listeners = new Set<Listener>();
let cache: { raw: string | null; value: WorldRoomAppearance } | null = null;
export function getWorldRoomAppearance(): WorldRoomAppearance {
 let raw: string | null = null;
 try { raw = typeof localStorage === "undefined" ? null : localStorage.getItem(WORLD_PRESENTATION_KEY); } catch { raw = null; }
 if (cache && cache.raw === raw) return cache.value;
 let parsed: unknown = null;
 try { parsed = raw ? JSON.parse(raw) : null; } catch { parsed = null; }
 cache = { raw, value: Object.freeze(cleanWorldRoomAppearance(parsed)) };
 return cache.value;
}
export function setWorldRoomAppearance(next: Partial<WorldRoomAppearance>): WorldRoomAppearance {
 const value = cleanWorldRoomAppearance({ ...getWorldRoomAppearance(), ...next });
 try { localStorage.setItem(WORLD_PRESENTATION_KEY, JSON.stringify(value)); } catch { /* storage unavailable: keep defaults */ }
 cache = null;
 for (const l of listeners) l();
 return getWorldRoomAppearance();
}
export function subscribeWorldRoomAppearance(listener: Listener): () => void {
 listeners.add(listener);
 const onStorage = (e: StorageEvent) => { if (e.key === WORLD_PRESENTATION_KEY) { cache = null; listener(); } };
 if (typeof window !== "undefined") window.addEventListener("storage", onStorage);
 return () => { listeners.delete(listener); if (typeof window !== "undefined") window.removeEventListener("storage", onStorage); };
}
/** Device hints for the automatic look (browser only; server render assumes desktop). */
export function worldDeviceHints(): WorldDeviceHints {
 if (typeof window === "undefined") return { width: 1280, coarse: false };
 const media = (q: string) => typeof window.matchMedia === "function" && window.matchMedia(q).matches;
 const connection = (navigator as Navigator & { connection?: { saveData?: boolean } }).connection;
 return { width: window.innerWidth || 1280, coarse: media("(pointer: coarse)"), saveData: !!connection?.saveData };
}
/**
 * Whether the HD office replaces the current Living World room: feature flag on, office theme,
 * and the look resolves to HD on this device (or is forced to HD).
 */
export function worldUsesHdOffice(appearance: WorldRoomAppearance, theme: string, hints: WorldDeviceHints): boolean {
 return appearance.hdOffice && theme === "linux" && worldPresentation(appearance.look, hints) === "hd";
}

/** Stage 1b selection only: never mounts a room or changes the current renderer. */
export function worldUsesIsoOffice(appearance: WorldRoomAppearance, theme: string, hints: WorldDeviceHints): boolean {
 return appearance.isoOffice === true && worldUsesHdOffice(appearance, theme, hints)
  && hints.width > WORLD_PIXEL_MAX_WIDTH && !hints.saveData && !hints.lowPower;
}

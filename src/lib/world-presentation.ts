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

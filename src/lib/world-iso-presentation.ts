import { worldPresentation, type WorldDeviceHints, type WorldRoomAppearance } from "./world-presentation";

/**
 * Living Universe — Isometric Office preview (Step 1b, Stage 1): the optional presentation preference.
 *
 * Not wired into the app: nothing reads this preference yet and no control sets it (Stage 4 is not authorized).
 *
 * `isoOffice` is a per-device boolean, default false. It is stored under its OWN localStorage key, using the
 * same mechanism as Room Appearance (JSON value, cleaned on read, storage events for other tabs). It is kept
 * out of the existing Room Appearance record on purpose: that record's shape ({ look, hdOffice, synthetic })
 * is asserted by existing tests and rewritten whole on every save, so adding a field there would change an
 * existing stored schema. With a separate key the HD / Pixel / Classic settings are never read differently,
 * never rewritten, and an older build simply ignores the preview key.
 *
 * Anything missing, malformed or unreadable resolves to "off", which means the existing Office.
 */
export const WORLD_ISO_PREFERENCE_KEY = "pixel-pals-iso-office-preview-v1";
export type WorldIsoPreference = Readonly<{ /** Show the isometric Office preview on this device. */ isoOffice: boolean }>;
export const WORLD_ISO_PREFERENCE_DEFAULT: WorldIsoPreference = Object.freeze({ isoOffice: false });

/** Only the exact boolean `true` turns the preview on. */
export function cleanWorldIsoPreference(value: unknown): WorldIsoPreference {
 const v = value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : {};
 return v["isoOffice"] === true ? Object.freeze({ isoOffice: true }) : WORLD_ISO_PREFERENCE_DEFAULT;
}

type Listener = () => void;
const listeners = new Set<Listener>();
let cache: { raw: string | null; value: WorldIsoPreference } | null = null;
export function getWorldIsoPreference(): WorldIsoPreference {
 let raw: string | null = null;
 try { raw = typeof localStorage === "undefined" ? null : localStorage.getItem(WORLD_ISO_PREFERENCE_KEY); } catch { raw = null; }
 if (cache && cache.raw === raw) return cache.value;
 let parsed: unknown = null;
 try { parsed = raw ? JSON.parse(raw) : null; } catch { parsed = null; }
 cache = { raw, value: cleanWorldIsoPreference(parsed) };
 return cache.value;
}
export function setWorldIsoPreference(next: Partial<WorldIsoPreference>): WorldIsoPreference {
 const value = cleanWorldIsoPreference({ ...getWorldIsoPreference(), ...next });
 try { localStorage.setItem(WORLD_ISO_PREFERENCE_KEY, JSON.stringify(value)); } catch { /* storage unavailable: stays off */ }
 cache = null;
 for (const l of listeners) l();
 return getWorldIsoPreference();
}
export function subscribeWorldIsoPreference(listener: Listener): () => void {
 listeners.add(listener);
 const onStorage = (e: StorageEvent) => { if (e.key === WORLD_ISO_PREFERENCE_KEY) { cache = null; listener(); } };
 if (typeof window !== "undefined") window.addEventListener("storage", onStorage);
 return () => { listeners.delete(listener); if (typeof window !== "undefined") window.removeEventListener("storage", onStorage); };
}

/** Which Office room a device should show. "current" is whatever the app shows today without any preview. */
export type WorldOfficeRoom = "iso" | "hd" | "current";
export type WorldOfficeRoomInput = Readonly<{
 iso: WorldIsoPreference | null | undefined;
 appearance: WorldRoomAppearance;
 theme: string;
 hints: WorldDeviceHints;
 /** Classic mode is on: the Living Universe rooms are not used at all. */
 classic?: boolean;
 /** The isometric preview failed (invalid plan or a render error): fall back. */
 isoFailed?: boolean;
}>;
/**
 * Selection rule for a future Stage 4 mount (pure; unused today).
 * - Classic mode, a theme other than the Office ("linux"), or a look that resolves to Pixel → "current".
 * - Otherwise the isometric preview shows only when `isoOffice` is exactly true and it has not failed.
 * - Otherwise the flat HD office shows if its own existing flag is on, else "current".
 * The preview never changes the HD / Pixel / Classic choice; it only selects among rooms once the look is HD.
 */
export function worldOfficeRoom({ iso, appearance, theme, hints, classic = false, isoFailed = false }: WorldOfficeRoomInput): WorldOfficeRoom {
 if (classic || theme !== "linux" || worldPresentation(appearance.look, hints) !== "hd") return "current";
 if (iso?.isoOffice === true && !isoFailed) return "iso";
 return appearance.hdOffice === true ? "hd" : "current";
}

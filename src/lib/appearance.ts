/** Colour scheme and text size, kept per device and synced with your account. The Normal theme gets a light look; themed casts keep their own palettes. */
export type Scheme = "dark" | "light" | "auto";
export type TextSize = "small" | "normal" | "large";
export type Appearance = { scheme: Scheme; size: TextSize };

export const APPEARANCE_KEY = "pixel-pals-appearance-v1";
export const defaultAppearance: Appearance = { scheme: "dark", size: "normal" };

/** "light:large" → parts. Anything unexpected falls back to the defaults. */
export function parseAppearance(raw: string | null | undefined): Appearance {
  const [scheme, size] = (raw ?? "").split(":");
  return {
    scheme: scheme === "light" || scheme === "auto" || scheme === "dark" ? scheme : defaultAppearance.scheme,
    size: size === "small" || size === "large" || size === "normal" ? size : defaultAppearance.size,
  };
}
export const formatAppearance = (a: Appearance): string => `${a.scheme}:${a.size}`;

/** Words you can type: "light", "dark", "auto", "small", "normal", "large", or two of them. */
export function appearanceFromWords(text: string, current: Appearance): Appearance | null {
  let next = { ...current };
  let hit = false;
  for (const w of text.toLowerCase().split(/[\s,]+/).filter(Boolean)) {
    if (w === "light" || w === "dark" || w === "auto") { next = { ...next, scheme: w }; hit = true; }
    else if (w === "small" || w === "normal" || w === "large") { next = { ...next, size: w }; hit = true; }
    else if (w === "big" || w === "bigger") { next = { ...next, size: "large" }; hit = true; }
    else return null;
  }
  return hit ? next : null;
}

export const resolveScheme = (s: Scheme, systemLight: boolean): "dark" | "light" => (s === "auto" ? (systemLight ? "light" : "dark") : s);

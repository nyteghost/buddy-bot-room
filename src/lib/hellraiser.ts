import { useSyncExternalStore } from "react";

const key = "pixel-pals-hellraiser-v1";
const characterKey = "pixel-pals-character-mode-v1";
export const characterModes = ["normal", "hellraiser", "horror", "matrix", "finalfantasy"] as const;
export type CharacterMode = (typeof characterModes)[number];
export function isCharacterMode(value: unknown): value is CharacterMode {
  return characterModes.some(mode => mode === value);
}
const listeners = new Set<() => void>();
let currentMode: CharacterMode = "normal";
if (typeof window !== "undefined") {
  try {
    const saved = localStorage.getItem(characterKey);
    currentMode = isCharacterMode(saved)
      ? saved
      : localStorage.getItem(key) === "1" ? "hellraiser" : "normal";
  } catch { /* storage unavailable */ }
}

export function setHellraiser(value: boolean) {
  setCharacterMode(value ? "hellraiser" : "normal");
}
export function setCharacterMode(value: CharacterMode) {
  currentMode = value;
  try {
    localStorage.setItem(characterKey, value);
    localStorage.setItem(key, value === "hellraiser" ? "1" : "0");
  } catch {
    /* storage unavailable */
  }
  listeners.forEach((l) => l());
}
export function useHellraiser() {
  return useCharacterMode() === "hellraiser";
}
export function useCharacterMode() {
  return useSyncExternalStore(
    (l) => (listeners.add(l), () => listeners.delete(l)),
    () => currentMode,
    () => "normal" as CharacterMode,
  );
}
export function characterModeCommand(text: string): CharacterMode | null {
  const t = text.trim().toLowerCase().replace(/[.!]+$/, "");
  if (t === "matrix mode" || t === "matrix theme") return "matrix";
  if (t === "final fantasy mode" || t === "final fantasy theme") return "finalfantasy";
  if (t === "matrix mode off" || t === "final fantasy mode off") return "normal";
  if (t === "horror mode" || t === "horror mode on") return "horror";
  if (t === "horror mode off") return "normal";
  const hell = modeCommand(text);
  return hell === "on" ? "hellraiser" : hell === "off" ? "normal" : null;
}
/** Returns "on" / "off" when the text is a mode command, otherwise null. */
export function modeCommand(text: string): "on" | "off" | null {
  const t = text.trim().toLowerCase().replace(/[.!]+$/, "");
  if (t === "hellraiser mode" || t === "hellraiser mode on") return "on";
  if (t === "hellraiser mode off" || t === "normal mode" || t === "close the box") return "off";
  return null;
}

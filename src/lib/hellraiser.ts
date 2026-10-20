import { useSyncExternalStore } from "react";

const key = "pixel-pals-hellraiser-v1";
const characterKey = "pixel-pals-character-mode-v1";
// "assistant" is kept only so old saved discussions/settings still load; it maps to Linux theme + Assistant on.
export const characterModes = ["normal", "hellraiser", "horror", "matrix", "finalfantasy", "devteam", "cyberpunk", "dcc", "linux", "assistant"] as const;
export type CharacterMode = (typeof characterModes)[number];
export function isCharacterMode(value: unknown): value is CharacterMode {
  return characterModes.some(mode => mode === value);
}
const listeners = new Set<() => void>();
let currentMode: CharacterMode = "normal";
let assistantOn = false;
if (typeof window !== "undefined") {
  try {
    const saved = localStorage.getItem(characterKey);
    currentMode = isCharacterMode(saved)
      ? saved
      : localStorage.getItem(key) === "1" ? "hellraiser" : "normal";
    // The office look is just the Linux theme now; the separate Assistant switch is gone (@mail, @tasks and @calendar always work).
    if (currentMode === "assistant") currentMode = "linux";
    assistantOn = isAssistantFamily(currentMode);
  } catch { /* storage unavailable */ }
}
const emit = () => listeners.forEach((l) => l());

export function setHellraiser(value: boolean) {
  setCharacterMode(value ? "hellraiser" : "normal");
}
export function setCharacterMode(value: CharacterMode) {
  if (value === "assistant") value = "linux";
  currentMode = value;
  assistantOn = isAssistantFamily(value);
  try {
    localStorage.setItem(characterKey, value);
    localStorage.setItem(key, value === "hellraiser" ? "1" : "0");
  } catch {
    /* storage unavailable */
  }
  emit();
}
/** Kept for old commands: "assistant on" now picks the Linux (office) theme, "off" goes back to Normal. */
export function setAssistantMode(value: boolean) {
  if (value) setCharacterMode("linux");
  else if (currentMode === "linux") setCharacterMode("normal");
}
export function useAssistantMode() {
  return useSyncExternalStore(
    (l) => (listeners.add(l), () => listeners.delete(l)),
    () => assistantOn,
    () => false,
  );
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
/** "assistant mode" / "assistant mode off" toggle the assistant switch; returns true when handled. */
export function assistantCommand(text: string): boolean | null {
  const t = text.trim().toLowerCase().replace(/[.!]+$/, "");
  if (t === "assistant mode" || t === "assistant mode on") return true;
  if (t === "assistant mode off") return false;
  return null;
}
export function characterModeCommand(text: string): CharacterMode | null {
  const t = text.trim().toLowerCase().replace(/[.!]+$/, "");
  if (t === "matrix mode" || t === "matrix theme") return "matrix";
  if (t === "final fantasy mode" || t === "final fantasy theme") return "finalfantasy";
  if (t === "dev team mode" || t === "developer mode" || t === "dev team theme") return "devteam";
  if (t === "cyberpunk mode" || t === "cyberpunk theme") return "cyberpunk";
  if (t === "dungeon crawler carl" || t === "dungeon crawler carl mode" || t === "dcc mode" || t === "dungeon mode") return "dcc";
  if (t === "linux mode" || t === "linux theme" ) return "linux";
  if (t === "linux mode off" || t === "cyberpunk mode off" || t === "matrix mode off" || t === "final fantasy mode off" || t === "dev team mode off" || t === "dcc mode off") return "normal";
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
/** Legacy theme ids that always meant assistant behaviour. */
export function isAssistantFamily(mode: unknown): mode is "linux" | "assistant" {
  return mode === "linux" || mode === "assistant";
}

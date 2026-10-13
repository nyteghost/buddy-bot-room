import { useSyncExternalStore } from "react";

const key = "pixel-pals-hellraiser-v1";
const listeners = new Set<() => void>();
let on = false;
if (typeof window !== "undefined") on = localStorage.getItem(key) === "1";

export function setHellraiser(value: boolean) {
  on = value;
  try {
    localStorage.setItem(key, value ? "1" : "0");
  } catch {
    /* storage unavailable */
  }
  listeners.forEach((l) => l());
}
export function useHellraiser() {
  return useSyncExternalStore(
    (l) => (listeners.add(l), () => listeners.delete(l)),
    () => on,
    () => false,
  );
}
/** Returns "on" / "off" when the text is a mode command, otherwise null. */
export function modeCommand(text: string): "on" | "off" | null {
  const t = text.trim().toLowerCase().replace(/[.!]+$/, "");
  if (t === "hellraiser mode") return "on";
  if (t === "normal mode" || t === "close the box") return "off";
  return null;
}

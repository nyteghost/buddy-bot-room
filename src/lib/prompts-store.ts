import { useSyncExternalStore } from "react";
import { parsePrompts, type SavedPrompt } from "./prompts";

const KEY = "pixel-pals-prompts-v1";
const listeners = new Set<() => void>();
let cache: SavedPrompt[] | null = null;
const none: SavedPrompt[] = [];
function read(): SavedPrompt[] {
  if (cache) return cache;
  try { cache = parsePrompts(JSON.parse(localStorage.getItem(KEY) ?? "[]")); } catch { cache = []; }
  return cache;
}
export function setPrompts(next: SavedPrompt[]): void {
  cache = next;
  try { localStorage.setItem(KEY, JSON.stringify(next)); } catch { /* optional storage */ }
  listeners.forEach((l) => l());
}
export const getPrompts = read;
export function usePrompts(): SavedPrompt[] {
  return useSyncExternalStore((l) => (listeners.add(l), () => listeners.delete(l)), read, () => none);
}

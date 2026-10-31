import { useSyncExternalStore } from "react";
import { FOCUS_CHECKPOINT_KEY, readFocusCheckpoint, type FocusSession } from "./focus-companion";

const listeners = new Set<() => void>();
let rawCache: string | null | undefined;
let snapshot: FocusSession | null = null;
export function getFocusCheckpoint(): FocusSession | null {
  let raw: string | null;
  try { raw = localStorage.getItem(FOCUS_CHECKPOINT_KEY); } catch { raw = null; }
  if (raw !== rawCache) { rawCache = raw; snapshot = readFocusCheckpoint(raw); }
  return snapshot;
}
const emit = () => listeners.forEach(listener => listener());
const changed = (event: StorageEvent) => { if (event.key === null || event.key === FOCUS_CHECKPOINT_KEY) emit(); };
function subscribe(listener: () => void) {
  if (!listeners.size) window.addEventListener("storage", changed);
  listeners.add(listener);
  return () => { listeners.delete(listener); if (!listeners.size) window.removeEventListener("storage", changed); };
}
/** Only explicit Save/Clear actions write a checkpoint. No server calls or chat capture. */
export function saveFocusCheckpoint(session: FocusSession | null): boolean {
  try {
    if (session) {
      const raw = JSON.stringify(session);
      if (!readFocusCheckpoint(raw)) return false;
      localStorage.setItem(FOCUS_CHECKPOINT_KEY, raw);
    } else localStorage.removeItem(FOCUS_CHECKPOINT_KEY);
    emit();
    return true;
  } catch { return false; }
}
export const useFocusCheckpoint = () => useSyncExternalStore(subscribe, getFocusCheckpoint, () => null);

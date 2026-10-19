import { useSyncExternalStore } from "react";

/** A tiny boolean preference kept in localStorage (and synced with your account via settings-io). */
export function boolPref(key: string, fallback = false) {
  const listeners = new Set<() => void>();
  let cache: boolean | null = null;
  const read = () => {
    if (cache !== null) return cache;
    try { const v = localStorage.getItem(key); cache = v === null ? fallback : v === "1"; } catch { cache = fallback; }
    return cache;
  };
  return {
    get: read,
    set(v: boolean) {
      cache = v;
      try { localStorage.setItem(key, v ? "1" : "0"); } catch { /* optional storage */ }
      listeners.forEach((l) => l());
    },
    use: () => useSyncExternalStore((l) => (listeners.add(l), () => listeners.delete(l)), read, () => fallback),
  };
}

export const AUTO_SEARCH_KEY = "pixel-pals-autosearch-v1";
export const autoSearch = boolPref(AUTO_SEARCH_KEY, false);

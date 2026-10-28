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

/** A small text preference in localStorage (for example the active project). Empty string means "none". */
export function textPref(key: string, max = 60) {
  const listeners = new Set<() => void>();
  let cache: string | null = null;
  const read = () => {
    if (cache !== null) return cache;
    try { cache = (localStorage.getItem(key) ?? "").slice(0, max); } catch { cache = ""; }
    return cache;
  };
  return {
    get: read,
    set(v: string) {
      cache = v.trim().slice(0, max);
      try { localStorage.setItem(key, cache); } catch { /* optional storage */ }
      listeners.forEach((l) => l());
    },
    use: () => useSyncExternalStore((l) => (listeners.add(l), () => listeners.delete(l)), read, () => ""),
  };
}
export const activeProject = textPref("pixel-pals-active-project-v1");

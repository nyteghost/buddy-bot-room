import { useEffect, useSyncExternalStore } from "react";

/** "Hide secrets": blurs anything marked with the `secret` class (addresses, share links, tokens) so you can screenshot the app safely. Per device. */
const KEY = "pixel-pals-hide-secrets";
const listeners = new Set<() => void>();
let cache: boolean | null = null;
function read(): boolean {
  if (cache !== null) return cache;
  try { cache = localStorage.getItem(KEY) === "1"; } catch { cache = false; }
  return cache;
}
export function setHideSecrets(on: boolean): void {
  cache = on;
  try { localStorage.setItem(KEY, on ? "1" : "0"); } catch { /* optional storage */ }
  listeners.forEach((l) => l());
}
export const getHideSecrets = read;
const subscribe = (l: () => void) => (listeners.add(l), () => listeners.delete(l));

export function useHideSecrets(): boolean {
  const on = useSyncExternalStore(subscribe, read, () => false);
  useEffect(() => {
    if (on) document.documentElement.dataset["hideSecrets"] = "1";
    else delete document.documentElement.dataset["hideSecrets"];
  }, [on]);
  return on;
}

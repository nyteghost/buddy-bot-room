import { useEffect, useSyncExternalStore } from "react";
import { APPEARANCE_KEY, defaultAppearance, formatAppearance, parseAppearance, resolveScheme, type Appearance } from "./appearance";

const listeners = new Set<() => void>();
let cache: Appearance | null = null;
function read(): Appearance {
  if (cache) return cache;
  try { cache = parseAppearance(localStorage.getItem(APPEARANCE_KEY)); } catch { cache = defaultAppearance; }
  return cache;
}
export function setAppearance(next: Appearance): void {
  cache = next;
  try { localStorage.setItem(APPEARANCE_KEY, formatAppearance(next)); } catch { /* optional storage */ }
  listeners.forEach((l) => l());
}
export const getAppearance = read;
const subscribe = (l: () => void) => (listeners.add(l), () => listeners.delete(l));

/** Call once near the top of the app: applies the choice to <html> and follows the system when set to Auto. */
export function useAppearance(): Appearance {
  const a = useSyncExternalStore(subscribe, read, () => defaultAppearance);
  useEffect(() => {
    const mq = window.matchMedia("(prefers-color-scheme: light)");
    const apply = () => {
      document.documentElement.dataset["scheme"] = resolveScheme(a.scheme, mq.matches);
      document.documentElement.dataset["size"] = a.size;
    };
    apply();
    mq.addEventListener("change", apply);
    return () => mq.removeEventListener("change", apply);
  }, [a]);
  return a;
}

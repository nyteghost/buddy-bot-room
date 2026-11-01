import { useSyncExternalStore } from "react";
import { startPolling } from "./poll";
import { EMPTY_OLLAMA_HEALTH, type OllamaHealth } from "./ollama-health";
let snapshot = EMPTY_OLLAMA_HEALTH;
let pending: Promise<OllamaHealth> | null = null;
const listeners = new Set<() => void>();
export function refreshOllamaHealth(): Promise<OllamaHealth> {
  if (pending) return pending;
  pending = (async () => {
    try {
      const res = await fetch("/api/ollama-health", { signal: AbortSignal.timeout(7000) });
      snapshot = res.ok
        ? ((await res.json()) as OllamaHealth)
        : {
            ...EMPTY_OLLAMA_HEALTH,
            state: "configuration",
            note: "Sign in as the owner to check Local AI.",
          };
    } catch {
      snapshot = {
        ...snapshot,
        state: "offline",
        reachable: false,
        note: "Could not check Local AI through Pixel Pals.",
      };
    } finally {
      pending = null;
      listeners.forEach((l) => l());
    }
    return snapshot;
  })();
  return pending;
}
let stop: (() => void) | null = null;
const update = () => {
  void refreshOllamaHealth();
};
function subscribe(listener: () => void) {
  listeners.add(listener);
  if (listeners.size === 1) {
    stop = startPolling(async () => (await refreshOllamaHealth()).reachable, 15000, {
      maxMs: 60000,
    });
    window.addEventListener("pixelpals:ollama-connected", update);
  }
  return () => {
    listeners.delete(listener);
    if (!listeners.size) {
      stop?.();
      stop = null;
      window.removeEventListener("pixelpals:ollama-connected", update);
    }
  };
}
export const useOllamaHealth = () =>
  useSyncExternalStore(
    subscribe,
    () => snapshot,
    () => EMPTY_OLLAMA_HEALTH,
  );

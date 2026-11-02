import { useEffect, useSyncExternalStore } from "react";
import { adaptiveDefaults, type AdaptiveToday } from "./adaptive-today";
import type { FocusSession } from "./focus-companion";
type State = {
  adaptive: AdaptiveToday;
  projects: { id: string; name: string }[];
  ready: boolean;
  note: string;
};
const initial: State = { adaptive: adaptiveDefaults(), projects: [], ready: false, note: "" };
let value = initial,
  loading: Promise<void> | undefined,
  chain: Promise<unknown> = Promise.resolve();
const listeners = new Set<() => void>();
function emit(next: State) {
  value = next;
  listeners.forEach((l) => l());
}
const subscribe = (fn: () => void) => {
  listeners.add(fn);
  return () => {
    listeners.delete(fn);
  };
};
export async function refreshAdaptive() {
  if (loading) return loading;
  loading = (async () => {
    try {
      const r = await fetch("/api/adaptive-today", { cache: "no-store" });
      const d = await r.json();
      if (!r.ok) {
        if (r.status === 403) emit({ ...initial, note: d.error });
        throw Error(d.error || "Today settings unavailable.");
      }
      emit({ adaptive: d.adaptive, projects: d.projects, ready: true, note: "" });
    } catch (e) {
      emit({ ...value, note: e instanceof Error ? e.message : "Today is unavailable." });
    } finally {
      loading = undefined;
    }
  })();
  return loading;
}
export function changeAdaptive(data: Record<string, unknown>, revision?: number): Promise<State> {
  const run = async () => {
    if (!value.ready) await refreshAdaptive();
    if (!value.ready)
      throw Error("Owner storage is unavailable; your current work stays in this browser.");
    const r = await fetch("/api/adaptive-today", {
      method: "POST",
      keepalive: true,
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ ...data, revision: revision ?? value.adaptive.revision }),
    });
    const d = await r.json();
    if (!r.ok) {
      emit({ ...value, note: d.error });
      throw Error(d.error || "Could not save Today.");
    }
    emit({ ...value, adaptive: d.adaptive, note: "Saved on Unraid." });
    window.dispatchEvent(new Event("pixelpals:adaptive-changed"));
    return value;
  };
  const work = chain.then(run, run);
  chain = work.catch(() => undefined);
  return work;
}
export function saveAdaptiveFocus(id: string, session: FocusSession) {
  return changeAdaptive({ op: "checkpoint", id, session });
}
export function useAdaptiveToday() {
  const state = useSyncExternalStore(
    subscribe,
    () => value,
    () => initial,
  );
  useEffect(() => {
    if (!value.ready) void refreshAdaptive();
  }, []);
  useEffect(() => {
    document.documentElement.dataset["dayMode"] = state.adaptive.mode;
  }, [state.adaptive.mode]);
  return state;
}

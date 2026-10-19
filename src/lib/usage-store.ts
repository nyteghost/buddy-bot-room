import { useSyncExternalStore } from "react";
import { overCap, trim, type CustomPrice, type UsageEntry } from "./usage";

const KEY = "pixel-pals-usage-v1";
const listeners = new Set<() => void>();
let cache: UsageEntry[] | null = null;

function read(): UsageEntry[] {
  if (cache) return cache;
  try {
    const parsed = JSON.parse(localStorage.getItem(KEY) ?? "[]");
    cache = Array.isArray(parsed) ? (parsed as UsageEntry[]).filter((e) => e && typeof e.t === "number" && typeof e.kind === "string") : [];
  } catch { cache = []; }
  return cache;
}
function write(next: UsageEntry[]) {
  cache = next;
  try { localStorage.setItem(KEY, JSON.stringify(next)); } catch { /* storage full */ }
  listeners.forEach((l) => l());
}

export function recordUsage(e: Omit<UsageEntry, "t">): void {
  write(trim([...read(), { ...e, t: Date.now() }], new Date()));
}
export const clearUsage = () => write([]);
export const usageNow = (): UsageEntry[] => read();
export const isOverCap = (capUsd: number, custom?: CustomPrice): boolean => overCap(read(), new Date(), capUsd, custom);

const empty: UsageEntry[] = [];
export function useUsage(): UsageEntry[] {
  return useSyncExternalStore((l) => (listeners.add(l), () => listeners.delete(l)), read, () => empty);
}

import { useSyncExternalStore } from "react";
import { award, emptyProgress, syncDone, type Progress } from "./progress";

const KEY = "pixel-pals-progress-v1";
const listeners = new Set<() => void>();
let cache: Progress | null = null;
const today = () => new Date().toLocaleDateString("en-CA");

function read(): Progress {
  if (cache) return cache;
  try {
    const p = JSON.parse(localStorage.getItem(KEY) ?? "null");
    cache = p && typeof p.xp === "number" ? { xp: p.xp, streak: Number(p.streak) || 0, lastDay: String(p.lastDay ?? ""), doneSeen: Number(p.doneSeen) || 0 } : emptyProgress;
  } catch { cache = emptyProgress; }
  return cache;
}
function write(next: Progress) {
  if (next === cache) return;
  cache = next;
  try { localStorage.setItem(KEY, JSON.stringify(next)); } catch { /* optional storage */ }
  listeners.forEach((l) => l());
}
export const awardXp = (amount: number) => write(award(read(), amount, today()));
export const syncDoneTasks = (doneNow: number) => write(syncDone(read(), doneNow, today()));
export function useProgress(): Progress {
  return useSyncExternalStore((l) => (listeners.add(l), () => listeners.delete(l)), read, () => emptyProgress);
}

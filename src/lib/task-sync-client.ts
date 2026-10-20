/** Browser side of the to-do sync: remembers the last agreed copy and talks to /api/tasks. Pure parts are in task-sync.ts. */
export type SyncItem = { id: string; text: string; done: boolean };
export type SyncBase = Record<string, SyncItem>;
const KEY = "pixel-pals-task-sync-v1";

export function readBase(): SyncBase {
  try { const v = JSON.parse(localStorage.getItem(KEY) ?? "{}") as SyncBase; return v && typeof v === "object" ? v : {}; } catch { return {}; }
}
export function writeBase(b: SyncBase): void {
  try { localStorage.setItem(KEY, JSON.stringify(b)); } catch { /* optional storage */ }
}

/** A short fingerprint of the list, to notice edits made while a sync was in flight. */
export const signature = (todos: { id: string; text: string; done: boolean }[]): string => todos.map((t) => `${t.id}:${t.done ? 1 : 0}:${t.text}`).join("|");

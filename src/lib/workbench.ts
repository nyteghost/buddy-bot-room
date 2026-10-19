import { useSyncExternalStore } from "react";

/**
 * The pals' shared "desk": things you asked them to remember, quick notes and to-dos.
 * Everything lives in this browser only. The pure helpers are separate from the storage hook so
 * they can be tested without a DOM.
 */
export type Entry = { id: string; text: string; at: number };
export type Todo = Entry & { done: boolean };
export type Workbench = { memories: Entry[]; notes: Entry[]; todos: Todo[] };

export const MAX_TEXT = 400;
export const MAX_ITEMS = 100;
export const emptyWorkbench: Workbench = { memories: [], notes: [], todos: [] };

const newId = () => (typeof crypto !== "undefined" && "randomUUID" in crypto ? crypto.randomUUID() : String(Math.random()).slice(2));
const clean = (text: string) => text.replace(/\s+/g, " ").trim().slice(0, MAX_TEXT);

export function addEntry(list: Entry[], text: string, at = Date.now()): Entry[] {
  const value = clean(text);
  if (!value) return list;
  if (list.some((e) => e.text.toLowerCase() === value.toLowerCase())) return list; // no duplicates
  return [...list, { id: newId(), text: value, at }].slice(-MAX_ITEMS);
}
export function addTodo(list: Todo[], text: string, at = Date.now()): Todo[] {
  const value = clean(text);
  if (!value) return list;
  return [...list, { id: newId(), text: value, at, done: false }].slice(-MAX_ITEMS);
}
/** 1-based, matching the numbers shown to the user. Out-of-range leaves the list unchanged. */
export function removeAt<T>(list: T[], n: number): T[] {
  return Number.isInteger(n) && n >= 1 && n <= list.length ? list.filter((_, i) => i !== n - 1) : list;
}
export function toggleTodo(list: Todo[], n: number): Todo[] {
  return Number.isInteger(n) && n >= 1 && n <= list.length
    ? list.map((t, i) => (i === n - 1 ? { ...t, done: !t.done } : t))
    : list;
}
export const clearDone = (list: Todo[]): Todo[] => list.filter((t) => !t.done);

/** The text handed to the pals so they can use it. Capped so it can't swamp small models. */
export function promptContext(w: Workbench, maxChars = 1500): string {
  const parts: string[] = [];
  if (w.memories.length) parts.push("Remembered about the human:\n" + w.memories.map((m) => `- ${m.text}`).join("\n"));
  const open = w.todos.filter((t) => !t.done);
  if (open.length) parts.push("The human's open to-dos:\n" + open.map((t) => `- ${t.text}`).join("\n"));
  const text = parts.join("\n\n");
  return text.length > maxChars ? text.slice(0, maxChars - 1) + "…" : text;
}

export function listText(title: string, items: { text: string; done?: boolean }[], empty: string): string {
  if (!items.length) return empty;
  return `${title}\n` + items.map((e, i) => `${i + 1}. ${e.done ? "~~" + e.text + "~~ ✓" : e.text}`).join("\n");
}

// ── storage ────────────────────────────────────────────────────────────────────────────────────
const key = "pixel-pals-workbench-v1";
const listeners = new Set<() => void>();
let cache: Workbench | null = null;

function valid(list: unknown): list is Entry[] {
  return Array.isArray(list) && list.every((e) => e && typeof e.id === "string" && typeof e.text === "string");
}
function read(): Workbench {
  if (cache) return cache;
  try {
    const parsed = JSON.parse(localStorage.getItem(key) ?? "null");
    cache = parsed && valid(parsed.memories) && valid(parsed.notes) && valid(parsed.todos)
      ? { memories: parsed.memories, notes: parsed.notes, todos: parsed.todos }
      : emptyWorkbench;
  } catch {
    cache = emptyWorkbench;
  }
  return cache!;
}
export function getWorkbench(): Workbench {
  return read();
}
export function updateWorkbench(change: (w: Workbench) => Workbench) {
  cache = change(read());
  try {
    localStorage.setItem(key, JSON.stringify(cache));
  } catch {
    /* storage full; keep in memory */
  }
  listeners.forEach((l) => l());
}
export function useWorkbench(): Workbench {
  return useSyncExternalStore(
    (l) => (listeners.add(l), () => listeners.delete(l)),
    read,
    () => emptyWorkbench,
  );
}

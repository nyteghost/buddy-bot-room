import { useSyncExternalStore } from "react";
import { nearDuplicate, pickMemories } from "./memory-rank";

/**
 * The pals' shared "desk": things you asked them to remember, quick notes and to-dos.
 * Everything lives in this browser only. The pure helpers are separate from the storage hook so
 * they can be tested without a DOM.
 */
export type Entry = { id: string; text: string; at: number; /** Always sent to the pals, never dropped to save space. */ pinned?: boolean; /** A condensed line standing in for older memories. */ digest?: boolean };
export type Todo = Entry & { done: boolean; source?: "brain-dump"; important?: boolean; reminderAt?: number; reminderId?: string };
/** `pal` holds memories only one pal sees, keyed by agent id. */
export type Workbench = { memories: Entry[]; notes: Entry[]; todos: Todo[]; pal?: Record<string, Entry[]> | undefined; /** Memories that only apply while that project is active. */ project?: Record<string, Entry[]> | undefined };

export const MAX_TEXT = 400;
export const MAX_ITEMS = 100;
export const emptyWorkbench: Workbench = { memories: [], notes: [], todos: [] };

const newId = () => (typeof crypto !== "undefined" && "randomUUID" in crypto ? crypto.randomUUID() : String(Math.random()).slice(2));
const clean = (text: string) => text.replace(/\s+/g, " ").trim().slice(0, MAX_TEXT);

export function addEntry(list: Entry[], text: string, at = Date.now()): Entry[] {
  const value = clean(text);
  if (!value) return list;
  if (list.some((e) => e.text.toLowerCase() === value.toLowerCase())) return list; // no duplicates
  // The same fact worded slightly differently refreshes the existing entry instead of piling up.
  const twin = nearDuplicate(list, value);
  if (twin) return list.map((e) => (e === twin ? { ...e, text: value, at } : e));
  return capped([...list, { id: newId(), text: value, at }]);
}
/** Keeps at most MAX_ITEMS, dropping the oldest unpinned first. */
function capped(list: Entry[]): Entry[] {
  let over = list.length - MAX_ITEMS;
  if (over <= 0) return list;
  return list.filter((e) => (e.pinned || over <= 0 ? true : (over--, false)));
}
/** Changes the wording of one memory (by id), keeping its place. */
export function editEntry(list: Entry[], id: string, text: string, at = Date.now()): Entry[] {
  const value = clean(text);
  return value ? list.map((e) => (e.id === id ? { ...e, text: value, at } : e)) : list;
}
export const togglePin = (list: Entry[], id: string): Entry[] => list.map((e) => (e.id === id ? (e.pinned ? (({ pinned: _p, ...rest }) => rest)(e) : { ...e, pinned: true }) : e));

/** Memories that belong to one project; only used while that project is active. */
export function addProjectMemory(w: Workbench, project: string, text: string, at = Date.now()): Workbench {
  const name = project.trim().slice(0, 60);
  return name ? { ...w, project: { ...(w.project ?? {}), [name]: addEntry(w.project?.[name] ?? [], text, at) } } : w;
}
export function setProjectMemories(w: Workbench, project: string, list: Entry[]): Workbench {
  const rest = { ...(w.project ?? {}) };
  if (list.length) rest[project] = list; else delete rest[project];
  return { ...w, project: rest };
}
export function addTodo(list: Todo[], text: string, at = Date.now(), source?: "brain-dump"): Todo[] {
  const value = clean(text);
  if (!value) return list;
  return [...list, { id: newId(), text: value, at, done: false, ...(source ? { source } : {}) }].slice(-MAX_ITEMS);
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

/** Memories private to one pal ("/remember @byte I use Arch"). Other pals never see them. */
export function addPalMemory(w: Workbench, pal: string, text: string, at = Date.now()): Workbench {
  return { ...w, pal: { ...(w.pal ?? {}), [pal]: addEntry(w.pal?.[pal] ?? [], text, at) } };
}
export function removePalMemory(w: Workbench, pal: string, target: number | "all"): Workbench {
  const list = w.pal?.[pal] ?? [];
  const next = target === "all" ? [] : removeAt(list, target);
  const rest = { ...(w.pal ?? {}) };
  if (next.length) rest[pal] = next; else delete rest[pal];
  return { ...w, pal: rest };
}

/** The text handed to the pals so they can use it. Capped so it can't swamp small models. Pass the speaking pal to include what only it knows. */
export function promptContext(w: Workbench, maxChars = 1500, pal?: string): string {
  const parts: string[] = [];
  if (w.memories.length) parts.push("Remembered about the human:\n" + w.memories.map((m) => `- ${m.text}`).join("\n"));
  const mine = pal ? w.pal?.[pal] ?? [] : [];
  if (mine.length) parts.push("Remembered just for you (the other pals don't know this):\n" + mine.map((m) => `- ${m.text}`).join("\n"));
  const open = w.todos.filter((t) => !t.done);
  if (open.length) parts.push("The human's open to-dos:\n" + open.map((t) => `- ${t.text}`).join("\n"));
  const text = parts.join("\n\n");
  return text.length > maxChars ? text.slice(0, maxChars - 1) + "…" : text;
}

/** Like promptContext, but when the memories do not all fit it keeps the ones that matter for this question (and says why in the Notes panel).
 *  Open to-dos are added after the memories. With everything fitting the result is the same as promptContext. */
export function promptContextFor(w: Workbench, query: string, o: { pal?: string | undefined; project?: string | undefined; access?: "all" | "own" | "none" | undefined; maxChars?: number; boost?: ReadonlyMap<string, number> | undefined } = {}): string {
  const maxChars = o.maxChars ?? 1500;
  const open = o.access === "none" ? [] : w.todos.filter((t) => !t.done);
  const todos = open.length ? "The human's open to-dos:\n" + open.map((t) => `- ${t.text}`).join("\n") : "";
  const pick = pickMemories(w, query, { pal: o.pal, project: o.project, access: o.access, maxChars: Math.max(400, maxChars - todos.length - 2), boost: o.boost });
  const text = [pick.text, todos].filter(Boolean).join("\n\n");
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
function validPal(v: unknown): v is Record<string, Entry[]> {
  return !!v && typeof v === "object" && !Array.isArray(v) && Object.values(v as Record<string, unknown>).every(valid);
}
function read(): Workbench {
  if (cache) return cache;
  try {
    const parsed = JSON.parse(localStorage.getItem(key) ?? "null");
    cache = parsed && valid(parsed.memories) && valid(parsed.notes) && valid(parsed.todos)
      ? { memories: parsed.memories, notes: parsed.notes, todos: parsed.todos, ...(validPal(parsed.pal) ? { pal: parsed.pal } : {}), ...(validPal(parsed.project) ? { project: parsed.project } : {}) }
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

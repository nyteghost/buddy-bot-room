import { addEntry, addTodo, type Workbench } from "./workbench";

/** Quick capture: text sent from your phone (Telegram, share sheet) that lands in your notes, tasks or memories. */
export type CaptureKind = "note" | "todo" | "memory";
export type Capture = { id: string; kind: CaptureKind; text: string; at: number };
export const MAX_CAPTURES = 100;

export type Parsed = { kind: CaptureKind | "remind"; text: string };

const PREFIXES: [RegExp, Parsed["kind"]][] = [
  [/^\/?(?:note|n)\s*[:\-]?\s+/i, "note"],
  [/^\/?(?:todo|task|to-do|t)\s*[:\-]?\s+/i, "todo"],
  [/^\/?(?:remember|memory|mem)\s*[:\-]?\s+/i, "memory"],
  [/^\/?remind(?:\s+me)?(?:\s*[:\-]|\s+)\s*/i, "remind"],
];

/** "todo: buy milk" → todo; "remind me in 1h stretch" → remind (the server schedules it); anything else is a normal question. */
export function parseCapture(input: string): Parsed | null {
  const t = input.trim();
  for (const [re, kind] of PREFIXES) {
    const m = re.exec(t);
    if (m) {
      const text = t.slice(m[0].length).replace(/\s+/g, " ").trim().slice(0, 400);
      return text ? { kind, text } : null;
    }
  }
  return null;
}

export function parseCaptures(raw: unknown): Capture[] {
  if (!Array.isArray(raw)) return [];
  return raw.flatMap((r): Capture[] => {
    const o = r as Partial<Capture> | null;
    const kind = o?.kind;
    return o && typeof o.id === "string" && (kind === "note" || kind === "todo" || kind === "memory") && typeof o.text === "string" && o.text && typeof o.at === "number"
      ? [{ id: o.id.slice(0, 24), kind, text: o.text.slice(0, 400), at: o.at }] : [];
  }).slice(-MAX_CAPTURES);
}

export function addCapture(list: Capture[], kind: CaptureKind, text: string, id: string, at: number): Capture[] {
  return [...list, { id, kind, text: text.slice(0, 400), at }].slice(-MAX_CAPTURES);
}

/** Fold captured items into the browser's notes, tasks and memories. */
export function mergeCaptures(w: Workbench, items: Capture[]): Workbench {
  let next = w;
  for (const c of items) {
    if (c.kind === "note") next = { ...next, notes: addEntry(next.notes, c.text, c.at) };
    else if (c.kind === "todo") next = { ...next, todos: addTodo(next.todos, c.text, c.at) };
    else next = { ...next, memories: addEntry(next.memories, c.text, c.at) };
  }
  return next;
}

export const captureLabel = (k: CaptureKind): string => (k === "note" ? "note" : k === "todo" ? "task" : "memory");

import { useSyncExternalStore } from "react";
import { chunkText, isReadableDoc, MAX_DOC_CHARS, MAX_TOTAL_CHARS, type Chunk, type Doc } from "./rag";

/** Documents you've dropped in for "chat with your files". Stored in this browser only. */
const KEY = "pixel-pals-docs-v1";
const empty: Doc[] = [];
const listeners = new Set<() => void>();
let cache: Doc[] | null = null;

function read(): Doc[] {
  if (cache) return cache;
  try {
    const parsed: unknown = JSON.parse(localStorage.getItem(KEY) ?? "[]");
    cache = Array.isArray(parsed) ? parsed.filter((d): d is Doc => !!d && typeof d.name === "string" && typeof d.text === "string") : empty;
  } catch { cache = empty; }
  return cache;
}
function write(next: Doc[]) {
  cache = next;
  try { localStorage.setItem(KEY, JSON.stringify(next)); } catch { /* memory only if storage is full */ }
  listeners.forEach((l) => l());
}
export const getDocs = read;
export const useDocs = (): Doc[] => useSyncExternalStore((l) => (listeners.add(l), () => listeners.delete(l)), read, () => empty);
export const removeDoc = (name: string) => write(read().filter((d) => d.name !== name));
export const clearDocs = () => write([]);

export type AddResult = { ok: true; name: string; chars: number; truncated: boolean } | { ok: false; name: string; error: string };

/** Pure: decide whether a file can be added given what's already stored. */
export function planAdd(existing: Doc[], name: string, text: string): AddResult & { docs?: Doc[] } {
  if (!isReadableDoc(name)) return { ok: false, name, error: "Only text-like files work (txt, md, csv, json, code…). For PDFs, copy the text into a .txt file." };
  const body = text.replace(/\u0000/g, "").trim();
  if (!body) return { ok: false, name, error: "That file is empty." };
  const truncated = body.length > MAX_DOC_CHARS;
  const kept = truncated ? body.slice(0, MAX_DOC_CHARS) : body;
  const others = existing.filter((d) => d.name !== name);
  const total = others.reduce((n, d) => n + d.text.length, 0) + kept.length;
  if (total > MAX_TOTAL_CHARS) return { ok: false, name, error: "Too much text stored already. Remove a document first." };
  return { ok: true, name, chars: kept.length, truncated, docs: [...others, { name, text: kept }] };
}

export async function addFile(file: File): Promise<AddResult> {
  const text = isReadableDoc(file.name) && file.size <= 2_000_000 ? await file.text() : "";
  if (file.size > 2_000_000) return { ok: false, name: file.name, error: "That file is over 2 MB." };
  const plan = planAdd(read(), file.name, text);
  if (plan.ok && plan.docs) write(plan.docs);
  return plan.ok ? { ok: true, name: plan.name, chars: plan.chars, truncated: plan.truncated } : plan;
}

export const allChunks = (docs: Doc[]): Chunk[] => docs.flatMap((d) => chunkText(d.name, d.text));

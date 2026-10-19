import { useSyncExternalStore } from "react";

/** Extra instructions you give each pal ("keep answers under 3 sentences", "always suggest a test"). Browser-only. */
export type AgentNotes = Record<string, string>;
export const MAX_NOTE = 400;
const KEY = "pixel-pals-agent-notes-v1";
const empty: AgentNotes = {};
const listeners = new Set<() => void>();
let cache: AgentNotes | null = null;

export function setNote(notes: AgentNotes, agentId: string, text: string): AgentNotes {
  const clean = text.replace(/\s+/g, " ").trim().slice(0, MAX_NOTE);
  const next = { ...notes };
  if (clean) next[agentId] = clean; else delete next[agentId];
  return next;
}
export function parseNotes(raw: unknown): AgentNotes {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return {};
  return Object.fromEntries(Object.entries(raw as Record<string, unknown>).filter(([, v]) => typeof v === "string" && v.trim()).map(([k, v]) => [k, String(v).slice(0, MAX_NOTE)]));
}
function read(): AgentNotes {
  if (cache) return cache;
  try { cache = parseNotes(JSON.parse(localStorage.getItem(KEY) ?? "{}")); } catch { cache = empty; }
  return cache;
}
export const getNotes = read;
export function updateNotes(fn: (n: AgentNotes) => AgentNotes) {
  cache = fn(read());
  try { localStorage.setItem(KEY, JSON.stringify(cache)); } catch { /* memory only */ }
  listeners.forEach((l) => l());
}
export const useAgentNotes = (): AgentNotes => useSyncExternalStore((l) => (listeners.add(l), () => listeners.delete(l)), read, () => empty);

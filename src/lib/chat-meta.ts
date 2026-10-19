import { useSyncExternalStore } from "react";

/** Pins and custom titles for saved chats. Kept separate from the chats so auto-save never overwrites them. */
export type ChatMeta = { pins: string[]; titles: Record<string, string> };
export const emptyMeta: ChatMeta = { pins: [], titles: {} };
const KEY = "pixel-pals-chatmeta-v1";
const MAX_TITLE = 120;

export function togglePin(meta: ChatMeta, id: string): ChatMeta {
  return { ...meta, pins: meta.pins.includes(id) ? meta.pins.filter((p) => p !== id) : [...meta.pins, id] };
}
/** An empty name removes the custom title and goes back to the automatic one. */
export function renameChat(meta: ChatMeta, id: string, title: string): ChatMeta {
  const clean = title.replace(/\s+/g, " ").trim().slice(0, MAX_TITLE);
  const titles = { ...meta.titles };
  if (clean) titles[id] = clean; else delete titles[id];
  return { ...meta, titles };
}
export const displayTitle = (meta: ChatMeta, id: string, fallback: string) => meta.titles[id] ?? fallback;

type Row = { id: string; title: string; updatedAt: string; messages: unknown[] };

/** Pinned chats first, then newest first. Stable for equal dates. */
export function sortRows<T extends Row>(rows: T[], meta: ChatMeta): T[] {
  const pinned = new Set(meta.pins);
  return [...rows].sort((a, b) => {
    const pa = pinned.has(a.id) ? 1 : 0;
    const pb = pinned.has(b.id) ? 1 : 0;
    if (pa !== pb) return pb - pa;
    return b.updatedAt.localeCompare(a.updatedAt);
  });
}

function textOf(row: Row): string {
  return row.messages
    .map((m) => {
      const parts = m && typeof m === "object" ? (m as { parts?: unknown }).parts : undefined;
      return Array.isArray(parts) ? parts.map((p) => (p && typeof p === "object" && typeof (p as { text?: unknown }).text === "string" ? (p as { text: string }).text : "")).join(" ") : "";
    })
    .join(" ");
}

/** Every word you typed must appear in the title or somewhere in the conversation. */
export function filterRows<T extends Row>(rows: T[], meta: ChatMeta, query: string): T[] {
  const words = query.toLowerCase().split(/\s+/).filter(Boolean);
  if (!words.length) return rows;
  return rows.filter((row) => {
    const hay = `${displayTitle(meta, row.id, row.title)} ${textOf(row)}`.toLowerCase();
    return words.every((w) => hay.includes(w));
  });
}

// ── storage ──
const listeners = new Set<() => void>();
let cache: ChatMeta | null = null;
function read(): ChatMeta {
  if (cache) return cache;
  try {
    const parsed = JSON.parse(localStorage.getItem(KEY) ?? "null");
    cache = parsed && Array.isArray(parsed.pins) && parsed.titles && typeof parsed.titles === "object" ? { pins: parsed.pins.filter((p: unknown) => typeof p === "string"), titles: parsed.titles } : emptyMeta;
  } catch { cache = emptyMeta; }
  return cache;
}
export const getChatMeta = read;
export function updateChatMeta(fn: (m: ChatMeta) => ChatMeta) {
  cache = fn(read());
  try { localStorage.setItem(KEY, JSON.stringify(cache)); } catch { /* keep in memory */ }
  listeners.forEach((l) => l());
}
export function useChatMeta(): ChatMeta {
  return useSyncExternalStore((l) => (listeners.add(l), () => listeners.delete(l)), read, () => emptyMeta);
}

import { useSyncExternalStore } from "react";

/**
 * Your own changes to the eight pals: name, role, personality, what memories they may see and whether they may read your calendar, mail and tasks.
 * The built-in characters (and every theme's own cast) stay as they are; an override only applies in the normal theme, and "Reset" removes it.
 * Stored in this browser (and your account's synced settings); the server receives it with each message and checks it again.
 */
export type MemoryAccess = "all" | "own" | "none";
export type Override = {
  name?: string;
  role?: string;
  tone?: string;
  /** all = shared + own + project memories (default); own = only what was told to this pal; none = no memories. */
  memory?: MemoryAccess;
  /** May this pal be given your calendar, unread-mail subjects and open tasks when a message asks for them? Default yes. */
  realData?: boolean;
};
export type Overrides = Record<string, Override>;

export const LIMITS = { name: 30, role: 80, tone: 400 } as const;
const text = (v: unknown, max: number): string | undefined => {
  if (typeof v !== "string") return undefined;
  const t = v.replace(/[\u0000-\u001f\u007f]+/g, " ").replace(/\s+/g, " ").trim().slice(0, max);
  return t || undefined;
};

/** Keeps only known fields with sane values, for known pal ids. Anything else (including bad JSON shapes) is dropped. */
export function cleanOverrides(v: unknown, ids: readonly string[]): Overrides {
  const out: Overrides = {};
  if (!v || typeof v !== "object" || Array.isArray(v)) return out;
  for (const id of ids) {
    const raw = (v as Record<string, unknown>)[id];
    if (!raw || typeof raw !== "object") continue;
    const r = raw as Record<string, unknown>;
    const o: Override = {};
    const name = text(r["name"], LIMITS.name), role = text(r["role"], LIMITS.role), tone = text(r["tone"], LIMITS.tone);
    if (name) o.name = name;
    if (role) o.role = role;
    if (tone) o.tone = tone;
    if (r["memory"] === "all" || r["memory"] === "own" || r["memory"] === "none") { if (r["memory"] !== "all") o.memory = r["memory"]; }
    if (r["realData"] === false) o.realData = false;
    if (Object.keys(o).length) out[id] = o;
  }
  return out;
}

/** Merges the wording fields over a built-in persona. Missing fields keep the built-in text. */
export function withOverride<T extends { name: string; role: string; tone: string }>(base: T, o: Override | undefined): T {
  return o && (o.name || o.role || o.tone) ? { ...base, name: o.name ?? base.name, role: o.role ?? base.role, tone: o.tone ?? base.tone } : base;
}

export const memoryAccess = (o: Overrides, id: string): MemoryAccess => o[id]?.memory ?? "all";
export const mayUseRealData = (o: Overrides, id: string): boolean => o[id]?.realData !== false;
export const setOverride = (all: Overrides, id: string, patch: Override | null): Overrides => {
  const rest = { ...all };
  delete rest[id];
  return patch && Object.keys(patch).length ? { ...rest, [id]: patch } : rest;
};

// ── browser storage (the server never reads this; it gets the overrides in each request) ──
export const OVERRIDES_KEY = "pixel-pals-characters-v1";
const listeners = new Set<() => void>();
let cache: Overrides | null = null;
let known: readonly string[] = [];
/** Told once by the app which pal ids exist (so unknown ids in stored data are ignored). */
export function setKnownPals(ids: readonly string[]): void { known = ids; cache = null; }

export function getOverrides(): Overrides {
  if (cache) return cache;
  try {
    cache = typeof localStorage === "undefined" ? {} : cleanOverrides(JSON.parse(localStorage.getItem(OVERRIDES_KEY) ?? "null"), known);
  } catch { cache = {}; }
  return cache;
}
export function updateOverrides(change: (o: Overrides) => Overrides): void {
  cache = cleanOverrides(change(getOverrides()), known);
  try { localStorage.setItem(OVERRIDES_KEY, JSON.stringify(cache)); } catch { /* optional storage */ }
  listeners.forEach((l) => l());
}
export function useOverrides(): Overrides {
  return useSyncExternalStore((l) => (listeners.add(l), () => listeners.delete(l)), getOverrides, () => ({}));
}

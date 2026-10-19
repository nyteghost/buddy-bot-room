import { useSyncExternalStore } from "react";
import type { EngineKind, EngineSettings, ReplyLength } from "./engine";

/** Named engine setups ("fast Groq", "deep Ollama"). API keys are never part of a preset. */
export type Preset = { name: string; kind: EngineKind; ollamaUrl: string; ollamaModel: string; replyLength: ReplyLength };
const KEY = "pixel-pals-presets-v1";
export const MAX_PRESETS = 12;

export function makePreset(name: string, e: EngineSettings): Preset | null {
  const clean = name.replace(/\s+/g, " ").trim().slice(0, 40);
  return clean ? { name: clean, kind: e.kind, ollamaUrl: e.ollamaUrl, ollamaModel: e.ollamaModel, replyLength: e.replyLength } : null;
}
/** Same name replaces the old preset. */
export function savePreset(list: Preset[], preset: Preset): Preset[] {
  return [...list.filter((p) => p.name.toLowerCase() !== preset.name.toLowerCase()), preset].slice(-MAX_PRESETS);
}
export const deletePreset = (list: Preset[], name: string): Preset[] => list.filter((p) => p.name !== name);
export function presetToEngine(p: Preset): Pick<EngineSettings, "kind" | "ollamaUrl" | "ollamaModel" | "replyLength"> {
  return { kind: p.kind, ollamaUrl: p.ollamaUrl, ollamaModel: p.ollamaModel, replyLength: p.replyLength };
}

const kinds = ["cloud", "local", "auto", "ollama", "auto-ollama"];
const lengths = ["short", "medium", "long"];
export function parsePresets(raw: unknown): Preset[] {
  if (!Array.isArray(raw)) return [];
  return raw.flatMap((p): Preset[] =>
    p && typeof p.name === "string" && kinds.includes(p.kind) && typeof p.ollamaUrl === "string" && typeof p.ollamaModel === "string" && lengths.includes(p.replyLength)
      ? [{ name: p.name.slice(0, 40), kind: p.kind, ollamaUrl: p.ollamaUrl, ollamaModel: p.ollamaModel, replyLength: p.replyLength }]
      : [],
  ).slice(0, MAX_PRESETS);
}

const listeners = new Set<() => void>();
let cache: Preset[] | null = null;
const empty: Preset[] = [];
function read(): Preset[] {
  if (cache) return cache;
  try { cache = parsePresets(JSON.parse(localStorage.getItem(KEY) ?? "[]")); } catch { cache = empty; }
  return cache;
}
export function updatePresets(fn: (l: Preset[]) => Preset[]) {
  cache = fn(read());
  try { localStorage.setItem(KEY, JSON.stringify(cache)); } catch { /* memory only */ }
  listeners.forEach((l) => l());
}
export const usePresets = (): Preset[] => useSyncExternalStore((l) => (listeners.add(l), () => listeners.delete(l)), read, () => empty);

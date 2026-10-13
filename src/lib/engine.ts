import { useSyncExternalStore } from "react";

/** Which brain powers the pals. Only "lovable" uses workspace AI credits. */
export type EngineKind = "lovable" | "groq" | "gemini" | "local";
export type EngineSettings = { kind: EngineKind; groqKey: string; geminiKey: string };

const key = "pixel-pals-engine-v1";
const fallback: EngineSettings = { kind: "lovable", groqKey: "", geminiKey: "" };
const listeners = new Set<() => void>();
let cache: EngineSettings | null = null;

function read(): EngineSettings {
  if (cache) return cache;
  try {
    const parsed = JSON.parse(localStorage.getItem(key) ?? "null");
    cache = parsed && typeof parsed.kind === "string" ? { ...fallback, ...parsed } : fallback;
  } catch {
    cache = fallback;
  }
  return cache!;
}

export function setEngine(next: Partial<EngineSettings>) {
  cache = { ...read(), ...next };
  try {
    localStorage.setItem(key, JSON.stringify(cache));
  } catch {
    /* storage full; keep in memory */
  }
  listeners.forEach((l) => l());
}

export function useEngine(): EngineSettings {
  return useSyncExternalStore(
    (l) => (listeners.add(l), () => listeners.delete(l)),
    read,
    () => fallback,
  );
}

/** The API key a free cloud engine needs, or undefined when none applies. */
export function engineKey(s: EngineSettings) {
  return s.kind === "groq" ? s.groqKey.trim() : s.kind === "gemini" ? s.geminiKey.trim() : "";
}

export const freeModels = {
  groq: "openai/gpt-oss-120b",
  gemini: "gemini-2.5-flash",
  local: "Qwen2.5-1.5B-Instruct-q4f16_1-MLC",
} as const;

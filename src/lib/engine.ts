import { useSyncExternalStore } from "react";

/** Which brain powers the pals. All options are free: "cloud" shares every entered free key, "local" runs in the browser. */
export type EngineKind = "cloud" | "local" | "auto";
export type FreeProvider = "groq" | "gemini" | "openrouter";
export type EngineSettings = { kind: EngineKind; groqKey: string; geminiKey: string; openrouterKey: string };

const key = "pixel-pals-engine-v1";
const fallback: EngineSettings = { kind: "cloud", groqKey: "", geminiKey: "", openrouterKey: "" };
const listeners = new Set<() => void>();
let cache: EngineSettings | null = null;

/** Older saves used "lovable", "groq" or "gemini"; they all become the shared free cloud mode. */
export function normalizeKind(kind: unknown): EngineKind {
  return kind === "local" || kind === "auto" ? kind : "cloud";
}

function read(): EngineSettings {
  if (cache) return cache;
  try {
    const parsed = JSON.parse(localStorage.getItem(key) ?? "null");
    cache = parsed && typeof parsed === "object" ? { ...fallback, ...parsed, kind: normalizeKind(parsed.kind) } : fallback;
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

/** Every free provider that has a key entered, in a stable order. */
export function availableProviders(s: EngineSettings): { kind: FreeProvider; apiKey: string }[] {
  const all: { kind: FreeProvider; apiKey: string }[] = [
    { kind: "groq", apiKey: s.groqKey.trim() },
    { kind: "gemini", apiKey: s.geminiKey.trim() },
    { kind: "openrouter", apiKey: s.openrouterKey.trim() },
  ];
  return all.filter((p) => p.apiKey);
}

/** Spread pals across all entered keys so each provider's free limit is shared out. */
export function providerForTurn(s: EngineSettings, turnIndex: number) {
  const list = availableProviders(s);
  return list.length ? list[turnIndex % list.length] : undefined;
}

export const freeModels = {
  groq: "openai/gpt-oss-120b",
  gemini: "gemini-2.5-flash",
  openrouter: "meta-llama/llama-3.3-70b-instruct:free",
  local: "Qwen2.5-1.5B-Instruct-q4f16_1-MLC",
} as const;

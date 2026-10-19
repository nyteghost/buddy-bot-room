import { useSyncExternalStore } from "react";
import { pickModel, type RouteHint } from "./model-catalog";

/** Which brain powers the pals. All options are free: "cloud" shares every entered free key, "local" runs in the browser. */
export type EngineKind = "cloud" | "local" | "auto" | "ollama" | "auto-ollama" | "local-server";
export type ReplyLength = "short" | "medium" | "long";
export const replyTokens: Record<ReplyLength, number> = { short: 400, medium: 800, long: 1500 };
export type FreeProvider = "groq" | "gemini" | "openrouter" | "nvidia";
/** Claude is a PAID provider, so it is never part of the free rotation unless the user opts in. */
export type TurnProvider = { kind: FreeProvider | "anthropic" | "ollama-server" | "custom"; apiKey: string; model?: string; maxTokens?: number; baseUrl?: string };
export type ClaudeMode = "off" | "share" | "only";
export const CLAUDE_MODELS = [
  { id: "claude-haiku-5-5", label: "Haiku 5.5 (cheapest)", price: "$0.10 in / $0.50 out per 1M tokens" },
  { id: "claude-sonnet-5-5", label: "Sonnet 5.5", price: "$2 in / $10 out per 1M tokens" },
  { id: "claude-opus-5-5", label: "Opus 5.5", price: "$4 in / $20 out per 1M tokens" },
] as const;
export const DEFAULT_CLAUDE_MODEL = CLAUDE_MODELS[0].id;
export type EngineSettings = {
  kind: EngineKind;
  groqKey: string;
  geminiKey: string;
  openrouterKey: string;
  nvidiaKey: string;
  /** Paid. Used only when claudeMode is not "off". */
  localChat: string;
  localCode: string;
  localReasoning: string;
  localFast: string;
  /** Pick the Code / Reasoning / Quick model automatically from what each message looks like. */
  localAuto: boolean;
  /** Optional model per pal id; overrides task routing. */
  localPals: Record<string, string>;
  /** Your own OpenAI-compatible provider. Off until you choose a mode. */
  customName: string;
  customBaseUrl: string;
  customKey: string;
  customModel: string;
  /** Tick this if the provider charges money; shows a warning. */
  customPaid: boolean;
  customMode: ClaudeMode;
  anthropicKey: string;
  claudeMode: ClaudeMode;
  claudeModel: string;
  ollamaUrl: string;
  ollamaModel: string;
  /** How long local-model replies may run: short (default), medium or long. */
  replyLength: ReplyLength;
};

const key = "pixel-pals-engine-v1";
const fallback: EngineSettings = {
  kind: "cloud",
  groqKey: "",
  geminiKey: "",
  openrouterKey: "",
  nvidiaKey: "",
  localChat: "qwen2.5:7b",
  localCode: "",
  localReasoning: "",
  localFast: "",
  localAuto: true,
  localPals: {},
  customName: "",
  customBaseUrl: "",
  customKey: "",
  customModel: "",
  customPaid: false,
  customMode: "off",
  anthropicKey: "",
  claudeMode: "off",
  claudeModel: DEFAULT_CLAUDE_MODEL,
  ollamaUrl: "http://localhost:11434/v1",
  ollamaModel: "qwen2.5:7b",
  replyLength: "short",
};
const listeners = new Set<() => void>();
let cache: EngineSettings | null = null;

/** Older saves used "lovable", "groq" or "gemini"; they all become the shared free cloud mode. */
export function normalizeKind(kind: unknown): EngineKind {
  return kind === "local" || kind === "auto" || kind === "ollama" || kind === "auto-ollama" || kind === "local-server" ? kind : "cloud";
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
    { kind: "nvidia", apiKey: s.nvidiaKey.trim() },
  ];
  return all.filter((p) => p.apiKey);
}

/** Spread pals across all entered keys so each provider's free limit is shared out. */
export function claudeProvider(s: EngineSettings): TurnProvider | undefined {
  const apiKey = (s.anthropicKey ?? "").trim();
  if (!apiKey || (s.claudeMode !== "share" && s.claudeMode !== "only")) return undefined;
  return { kind: "anthropic", apiKey, model: CLAUDE_MODELS.some((m) => m.id === s.claudeModel) ? s.claudeModel : DEFAULT_CLAUDE_MODEL };
}

/** Everything that may answer a turn: the free keys, plus Claude only if the user switched it on. */
export function customProvider(s: EngineSettings): TurnProvider | undefined {
  if ((s.customMode !== "share" && s.customMode !== "only") || !s.customBaseUrl.trim() || !s.customModel.trim()) return undefined;
  return { kind: "custom", apiKey: s.customKey.trim(), model: s.customModel.trim(), baseUrl: s.customBaseUrl.trim() };
}

export function turnProviders(s: EngineSettings): TurnProvider[] {
  const claude = claudeProvider(s);
  const custom = customProvider(s);
  if (claude && s.claudeMode === "only") return [claude];
  if (custom && s.customMode === "only") return [custom];
  return [...availableProviders(s), ...(claude ? [claude] : []), ...(custom ? [custom] : [])];
}

/** The model on the Ollama inside the stack, chosen per task when routing is on. */
export function localServerProvider(s: EngineSettings, hint: RouteHint = {}): TurnProvider {
  return { kind: "ollama-server", apiKey: "", model: pickModel(s, hint), maxTokens: replyTokens[s.replyLength] };
}

export function providerForTurn(s: EngineSettings, turnIndex: number, hint: RouteHint = {}): TurnProvider | undefined {
  if (s.kind === "local-server") return localServerProvider(s, hint);
  const list = turnProviders(s);
  return list.length ? list[turnIndex % list.length] : undefined;
}

export const freeModels = {
  groq: "openai/gpt-oss-120b",
  gemini: "gemini-2.5-flash",
  openrouter: "meta-llama/llama-3.3-70b-instruct:free",
  nvidia: "meta/llama-3.1-70b-instruct",
  local: "Qwen2.5-1.5B-Instruct-q4f16_1-MLC",
} as const;

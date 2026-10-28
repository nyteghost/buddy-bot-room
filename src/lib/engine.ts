import { useSyncExternalStore } from "react";
import { pickModel, type RouteHint } from "./model-catalog";

/** Which brain powers the pals. All options are free: "cloud" shares every entered free key, "local" runs in the browser. */
export type EngineKind = "cloud" | "local" | "auto" | "ollama" | "auto-ollama" | "local-server";
export type ReplyLength = "short" | "medium" | "long";
export const replyTokens: Record<ReplyLength, number> = { short: 400, medium: 800, long: 1500 };
export type FreeProvider = "groq" | "gemini" | "openrouter" | "nvidia";
/** Claude is a PAID provider, so it is never part of the free rotation unless the user opts in. */
export type TurnProvider = { kind: FreeProvider | "anthropic" | "ollama-server" | "custom"; apiKey: string; model?: string; maxTokens?: number; baseUrl?: string };
export type ClaudeMode = "off" | "share" | "only" | "fallback";
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
  /** Monthly spend cap in USD for paid providers (estimated). 0 = no cap. */
  spendCapUsd: number;
  /** What your custom provider costs per million tokens, for the spend estimate. */
  customPriceIn: number;
  customPriceOut: number;
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
  spendCapUsd: 0,
  customPriceIn: 0,
  customPriceOut: 0,
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

/** Settings from a saved JSON string (the account snapshot on the server). Missing fields get defaults. */
export function engineFromJson(raw: string | null | undefined): EngineSettings {
  try {
    const parsed = JSON.parse(raw ?? "null");
    return parsed && typeof parsed === "object" ? { ...fallback, ...parsed, kind: normalizeKind(parsed.kind) } : fallback;
  } catch {
    return fallback;
  }
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
export function claudeProvider(s: EngineSettings, modes: ClaudeMode[] = ["share", "only"]): TurnProvider | undefined {
  const apiKey = (s.anthropicKey ?? "").trim();
  if (!apiKey || !modes.includes(s.claudeMode)) return undefined;
  return { kind: "anthropic", apiKey, model: CLAUDE_MODELS.some((m) => m.id === s.claudeModel) ? s.claudeModel : DEFAULT_CLAUDE_MODEL };
}

/** Everything that may answer a turn: the free keys, plus Claude only if the user switched it on. */
export function customProvider(s: EngineSettings, modes: ClaudeMode[] = ["share", "only"]): TurnProvider | undefined {
  if (!modes.includes(s.customMode) || !s.customBaseUrl.trim() || !s.customModel.trim()) return undefined;
  return { kind: "custom", apiKey: s.customKey.trim(), model: s.customModel.trim(), baseUrl: s.customBaseUrl.trim() };
}

/** Paid providers are left out once the monthly cap is reached (blockPaid). */
export function turnProviders(s: EngineSettings, blockPaid = false): TurnProvider[] {
  const claude = blockPaid ? undefined : claudeProvider(s);
  const custom = blockPaid && s.customPaid ? undefined : customProvider(s);
  if (claude && s.claudeMode === "only") return [claude];
  if (custom && s.customMode === "only") return [custom];
  const free = availableProviders(s);
  return [...free, ...(claude ? [claude] : []), ...(custom ? [custom] : [])];
}

/** Providers set to "only when others fail". Tried after everything in the normal rotation has errored. */
export function fallbackProviders(s: EngineSettings, blockPaid = false): TurnProvider[] {
  const claude = blockPaid ? undefined : claudeProvider(s, ["fallback"]);
  const custom = blockPaid && s.customPaid ? undefined : customProvider(s, ["fallback"]);
  return [claude, custom].filter((p): p is TurnProvider => !!p);
}

/** When your own Ollama can't be reached: every cloud AI you have set up, free keys first, and a paid one only if you switched it on (share, only or fallback). Empty means nothing else is set up. */
export function cloudFallbackChain(s: EngineSettings, blockPaid = false): TurnProvider[] {
  const seen = new Set<string>();
  return [...turnProviders(s, blockPaid), ...fallbackProviders(s, blockPaid)].filter((p) => (seen.has(p.kind) ? false : (seen.add(p.kind), true)));
}

/** AIs that just failed are put on a bench so the next turns skip them instead of waiting on them again. */
export type Bench = Map<string, number>;
export const benchKey = (p: Pick<TurnProvider, "kind" | "baseUrl">): string => `${p.kind}|${p.baseUrl ?? ""}`;
const TRANSIENT_BENCH_MS = 3 * 60_000;
const BROKEN_BENCH_MS = 15 * 60_000;

/** How long to skip an AI after it failed: longer when the key or model itself is wrong, shorter for limits and outages. */
export function benchMs(error: unknown): number {
  const msg = error instanceof Error ? error.message : String(error);
  return /HTTP (401|402|403|404)\b/.test(msg) ? BROKEN_BENCH_MS : TRANSIENT_BENCH_MS;
}
export function benchProvider(bench: Bench, p: Pick<TurnProvider, "kind" | "baseUrl">, error: unknown, now = Date.now()): void {
  bench.set(benchKey(p), now + benchMs(error));
}
export const isBenched = (bench: Bench, p: Pick<TurnProvider, "kind" | "baseUrl">, now = Date.now()): boolean => (bench.get(benchKey(p)) ?? 0) > now;

/** Same list, with benched AIs moved to the end: they are only tried when nothing else is left. Order is otherwise kept. */
export function orderByHealth(chain: TurnProvider[], bench: Bench, now = Date.now()): TurnProvider[] {
  return [...chain.filter((p) => !isBenched(bench, p, now)), ...chain.filter((p) => isBenched(bench, p, now))];
}

/** What to try, in order, when `failed` errored before producing text. */
export function chainAfter(s: EngineSettings, failed: TurnProvider, blockPaid = false): TurnProvider[] {
  if (failed.kind === "ollama-server") return [];
  const rotation = turnProviders(s, blockPaid).filter((p) => p.kind !== failed.kind || p.baseUrl !== failed.baseUrl);
  const fallback = fallbackProviders(s, blockPaid).filter((p) => p.kind !== failed.kind);
  return [...rotation, ...fallback];
}

/** The model on the Ollama inside the stack, chosen per task when routing is on. */
export function localServerProvider(s: EngineSettings, hint: RouteHint = {}): TurnProvider {
  return { kind: "ollama-server", apiKey: "", model: pickModel(s, hint), maxTokens: replyTokens[s.replyLength] };
}

export function providerForTurn(s: EngineSettings, turnIndex: number, hint: RouteHint = {}, blockPaid = false): TurnProvider | undefined {
  if (s.kind === "local-server") return localServerProvider(s, hint);
  const list = turnProviders(s, blockPaid);
  return list.length ? list[turnIndex % list.length] : undefined;
}

export const providerNames: Record<TurnProvider["kind"], string> = { groq: "Groq", gemini: "Gemini", openrouter: "OpenRouter", nvidia: "NVIDIA", anthropic: "Claude", "ollama-server": "Ollama", custom: "Custom" };
const shortModel = (m: string): string => (m.split("/").pop() ?? m).slice(0, 40);

/** Which AI answers for the pal at this position in the roster, in words: "Groq · gpt-oss-120b", "Ollama · qwen2.5:7b". Same rotation the chat uses. */
export function palEngineLabel(s: EngineSettings, rosterIndex: number): string {
  if (s.kind === "local") return "In-browser model";
  if (s.kind === "ollama") return `Ollama · ${s.ollamaModel}`;
  if (s.kind === "local-server") return "Ollama on your server";
  const list = turnProviders(s);
  const p = list.length ? list[Math.max(0, rosterIndex) % list.length] : undefined;
  if (!p) return s.kind === "auto-ollama" ? "Ollama" : "In-browser model";
  const model = p.model ?? (p.kind === "groq" || p.kind === "gemini" || p.kind === "openrouter" || p.kind === "nvidia" ? freeModels[p.kind] : "");
  return `${providerNames[p.kind]}${model ? ` · ${shortModel(model)}` : ""}`;
}

/** "Groq · gpt-oss-120b" for a provider on this turn (same words as palEngineLabel). */
export function providerLabel(p: Pick<TurnProvider, "kind"> & { model?: string | undefined }): string {
  const model = p.model ?? (p.kind === "groq" || p.kind === "gemini" || p.kind === "openrouter" || p.kind === "nvidia" ? freeModels[p.kind] : "");
  return `${providerNames[p.kind]}${model ? ` · ${shortModel(model)}` : ""}`;
}

/** What to show under a reply: who wrote it, and when a smaller local model took over because the first one did not fit, say so. */
export function answeredLabel(o: { via?: string | undefined; model?: string | undefined; fellBackFrom?: string | undefined }): string {
  if (o.fellBackFrom && o.model) return `Ollama · ${shortModel(o.model)} (smaller model: ${shortModel(o.fellBackFrom)} didn't fit)`;
  return o.via ?? "";
}

export const freeModels = {
  groq: "openai/gpt-oss-120b",
  gemini: "gemini-2.5-flash",
  openrouter: "openrouter/free",
  nvidia: "meta/llama-3.1-70b-instruct",
  local: "Qwen2.5-1.5B-Instruct-q4f16_1-MLC",
} as const;

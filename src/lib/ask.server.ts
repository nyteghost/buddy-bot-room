import { scrubChatText } from "./chat-scrub";
import { readOllamaHealth } from "./ollama-health.server";
import { installedName, modelProblem } from "./ollama-health";
import { generateText } from "ai";
import { createOpenAICompatible } from "@ai-sdk/openai-compatible";
import { engineFromJson, freeModels, localServerProvider, strataServerProvider, turnProviders, type EngineSettings, type TurnProvider } from "./engine";
import { strataConfigured, strataFallbackOllama, strataReadyModel, strataChat, strataConnection, StrataError } from "./strata.server";
import { accountFileName } from "./local-account";
import { ownerName } from "./accounts.server";
import { ollamaBase, resolveLocalModel } from "./ollama.server";
import { isModelName } from "./model-catalog";
import { handleSearch } from "./search.server";
import { wantsWeb, webContext } from "./web-context";
import type { SearchHit } from "./search";
import { logServer } from "./server-log.server";
import { assertInferenceAllowed, localOnlyOn } from "./ai/guard.server";
import { engineAllowed } from "./local-only";
import { withRetry } from "./ai/reliability";

/**
 * Unattended questions (scheduled tasks, the Telegram bot) answered with the OWNER's saved engine settings.
 * Only free keys and Local AI are used here: paid providers (Claude, custom) never run without you in the room,
 * so nothing can spend money while you're away.
 */
export async function ownerEngineJson(): Promise<string | null> {
  const dir = (process.env["BUDDY_DATA_DIR"] ?? "").trim().replace(/\/+$/, "");
  const name = await ownerName();
  if (!dir || !name) return null;
  const fs = (await import(/* @vite-ignore */ "node:" + "fs/promises")) as typeof import("node:fs/promises");
  try {
    const saved = JSON.parse(await fs.readFile(`${dir}/accounts/${await accountFileName(name)}`, "utf8")) as { data?: Record<string, string> };
    return saved.data?.["pixel-pals-engine-v1"] ?? null;
  } catch {
    return null;
  }
}

const FREE_BASE = {
  groq: "https://api.groq.com/openai/v1",
  openrouter: "https://openrouter.ai/api/v1",
  nvidia: "https://integrate.api.nvidia.com/v1",
  gemini: "https://generativelanguage.googleapis.com/v1beta/openai",
} as const;

function modelFor(p: TurnProvider): { base: string; model: string; key: string } | null {
  if (!engineAllowed(p.kind, localOnlyOn())) return null; // Local-Only AI mode: nothing but the stack's own Ollama
  if (p.kind === "ollama-server") return ollamaBase() && isModelName(p.model ?? "") ? { base: `${ollamaBase()}/v1`, model: String(p.model), key: "ollama" } : null;
  if (p.kind === "groq" || p.kind === "openrouter" || p.kind === "nvidia" || p.kind === "gemini") return { base: FREE_BASE[p.kind], model: freeModels[p.kind], key: p.apiKey };
  return null; // paid/custom providers are never used unattended
}

/** The engines an unattended question may use, in order. In Local-Only mode (or when asked to stay local) that is the stack's own Ollama and nothing else. */
export function askChain(s: EngineSettings, prompt: string, forceLocal = false): TurnProvider[] {
  if (s.kind === "strata-server") {
    if (!strataConfigured()) return [];
    return [strataServerProvider(s), ...(strataFallbackOllama() && ollamaBase() && s.localChat ? [localServerProvider(s, { text: prompt })] : [])];
  }
  const local = s.kind === "local-server" || forceLocal || localOnlyOn();
  const chain: TurnProvider[] = local ? [] : turnProviders(s, true).filter((p) => modelFor(p));
  if ((local || chain.length) && ollamaBase() && s.localChat) chain.push(localServerProvider(s, { text: prompt }));
  return chain;
}

export type AskResult = { ok: true; text: string; via: string } | { ok: false; error: string };

export async function askPals(prompt: string, opts: { system?: string; maxTokens?: number; localOnly?: boolean; signal?: AbortSignal | undefined } = {}): Promise<AskResult> {
  prompt=scrubChatText(prompt,{maskIdentifiers:process.env["CHAT_MASK_IDENTIFIERS"]==="on"});
  if (opts.signal?.aborted) return { ok: false, error: "Request cancelled." };
  const raw = await ownerEngineJson();
  if (!raw) return { ok: false, error: "No saved settings yet. Sign in, add a free key or set up Local AI, and open the room once so your settings sync to the server." };
  const s = engineFromJson(raw);
  const chain = askChain(s, prompt, opts.localOnly === true);
  if (!chain.length) return { ok: false, error: opts.localOnly || localOnlyOn() ? "Local-Only AI mode is on and protected Strata or Ollama is unavailable on this server." : "No free key or Local AI is saved for the owner account. Add one in engine settings." };

  let system = opts.system ?? "You are the Pixel Pals assistant answering a scheduled or phone request for the owner. Reply in plain text, no markdown headings, under 150 words unless asked for more. Be concrete. If you don't know something current, say so instead of guessing.";
  system += `\nNow: ${new Date().toISOString().slice(0, 16).replace("T", " ")} UTC.`;
  let user = prompt;
  if (!opts.localOnly && wantsWeb(prompt)) {
    try {
      const res = await handleSearch(new Request(`http://local/api/search?q=${encodeURIComponent(prompt.slice(0, 200))}`));
      const json = (await res.json()) as { hits?: SearchHit[] };
      if (res.ok && json.hits?.length) user = `${prompt}\n\n${webContext(prompt, json.hits.slice(0, 5))}`;
    } catch { /* search is optional */ }
  }
  let lastError = "";
  for (const original of chain) {
    if (opts.signal?.aborted) return { ok: false, error: "Request cancelled." };
    if (original.kind === "strata-server") {
      try {
        const model = await strataReadyModel();
        assertInferenceAllowed("strata-server", strataConnection().base, ollamaBase());
        const result = await strataChat([{ role: "system", content: system }, { role: "user", content: user }], model, fetch,
          { maxTokens: Math.min(4000, Math.max(1, Math.floor(opts.maxTokens ?? 2400))), ...(opts.signal ? { signal: opts.signal } : {}) });
        const output = scrubChatText(result.text.trim());
        if (output) return { ok: true, text: result.truncated ? output + "\n\n[Strata reached its token limit; the answer may be incomplete.]" : output,
          via: "Strata · " + result.model };
        lastError = "Strata returned an empty answer.";
      } catch (e) {
        if (opts.signal?.aborted) return { ok: false, error: "Request cancelled." };
        lastError = e instanceof StrataError ? e.message : "Strata local inference unavailable.";
      }
      continue;
    }
    const p = original.kind === "ollama-server" ? { ...original, model: (await resolveLocalModel(original.model ?? "")) ?? "" } : original;
    if (p.kind === "ollama-server") {
      const health = await readOllamaHealth(opts.signal);
      if (!health.reachable) return { ok: false, error: health.note ?? "Ollama is not reachable from Pixel Pals." };
      const exact = installedName(p.model ?? "", health.models.map(m => m.name));
      if (!exact) return { ok: false, error: modelProblem(p.model ?? "", health.models.map(m => m.name)) ?? "Choose an installed local model." };
      p.model = exact;
    }
    const m = modelFor(p);
    if (!m) continue;
    try {
      assertInferenceAllowed(p.kind, m.base, ollamaBase());
      const provider = createOpenAICompatible({ name: p.kind, apiKey: m.key || "none", baseURL: m.base });
      // Only connection-type failures are retried (twice, with backoff), so an answer is never produced twice.
      const out = await withRetry<{ text: string }>(() => generateText({ model: provider(m.model), system, prompt: user, maxOutputTokens: Math.min(1500, opts.maxTokens ?? 700), maxRetries: 0, abortSignal: opts.signal ? AbortSignal.any([opts.signal, AbortSignal.timeout(120_000)]) : AbortSignal.timeout(120_000) }), { retries: p.kind === "ollama-server" ? 2 : 0, ...(opts.signal ? { signal: opts.signal } : {}), onRetry: (n, e, ms) => logServer("warn", `ask retry ${n} in ${ms}ms: ${e instanceof Error ? e.message.slice(0, 80) : "error"}`) });
      const text = scrubChatText(out.text.trim());
      if (text) return { ok: true, text, via: p.kind === "ollama-server" ? `Local AI (${m.model})` : p.kind };
      lastError = "empty answer";
    } catch (e) {
      if (opts.signal?.aborted) return { ok: false, error: "Request cancelled." };
      lastError = e instanceof Error ? e.message.slice(0, 120) : "failed";
      logServer("warn", `ask via ${p.kind} failed: ${lastError}`);
    }
  }
  return { ok: false, error: `Every engine failed (${lastError}).` };
}

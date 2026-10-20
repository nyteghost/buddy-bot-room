import { generateText } from "ai";
import { createOpenAICompatible } from "@ai-sdk/openai-compatible";
import { engineFromJson, freeModels, localServerProvider, turnProviders, type TurnProvider } from "./engine";
import { accountFileName } from "./local-account";
import { ownerName } from "./accounts.server";
import { ollamaBase, resolveLocalModel } from "./ollama.server";
import { isModelName } from "./model-catalog";
import { handleSearch } from "./search.server";
import { wantsWeb, webContext } from "./web-context";
import type { SearchHit } from "./search";
import { logServer } from "./server-log.server";

/**
 * Unattended questions (scheduled tasks, the Telegram bot) answered with the OWNER's saved engine settings.
 * Only free keys and Local AI are used here: paid providers (Claude, custom) never run without you in the room,
 * so nothing can spend money while you're away.
 */
async function ownerEngineJson(): Promise<string | null> {
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
  if (p.kind === "ollama-server") return ollamaBase() && isModelName(p.model ?? "") ? { base: `${ollamaBase()}/v1`, model: String(p.model), key: "ollama" } : null;
  if (p.kind === "groq" || p.kind === "openrouter" || p.kind === "nvidia" || p.kind === "gemini") return { base: FREE_BASE[p.kind], model: freeModels[p.kind], key: p.apiKey };
  return null; // paid/custom providers are never used unattended
}

export type AskResult = { ok: true; text: string; via: string } | { ok: false; error: string };

export async function askPals(prompt: string, opts: { system?: string; maxTokens?: number; localOnly?: boolean } = {}): Promise<AskResult> {
  const raw = await ownerEngineJson();
  if (!raw) return { ok: false, error: "No saved settings yet. Sign in, add a free key or set up Local AI, and open the room once so your settings sync to the server." };
  const s = engineFromJson(raw);
  const local = s.kind === "local-server" || opts.localOnly === true;
  const chain: TurnProvider[] = local ? [] : turnProviders(s, true).filter((p) => modelFor(p));
  if ((local || chain.length) && ollamaBase() && s.localChat) chain.push(localServerProvider(s, { text: prompt }));
  if (!chain.length) return { ok: false, error: opts.localOnly ? "This needs Local AI (Ollama) on this server." : "No free key or Local AI is saved for the owner account. Add one in engine settings." };

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
    const p = original.kind === "ollama-server" ? { ...original, model: (await resolveLocalModel(original.model ?? "")) ?? "" } : original;
    const m = modelFor(p);
    if (!m) continue;
    try {
      const provider = createOpenAICompatible({ name: p.kind, apiKey: m.key || "none", baseURL: m.base });
      const out = await generateText({ model: provider(m.model), system, prompt: user, maxOutputTokens: Math.min(1500, opts.maxTokens ?? 700), maxRetries: 0, abortSignal: AbortSignal.timeout(120_000) });
      const text = out.text.trim();
      if (text) return { ok: true, text, via: p.kind === "ollama-server" ? `Local AI (${m.model})` : p.kind };
      lastError = "empty answer";
    } catch (e) {
      lastError = e instanceof Error ? e.message.slice(0, 120) : "failed";
      logServer("warn", `ask via ${p.kind} failed: ${lastError}`);
    }
  }
  return { ok: false, error: `Every engine failed (${lastError}).` };
}

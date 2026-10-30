export const AI_PROVIDERS = [
  { id: "openai", name: "OpenAI", connection: "Available for task suggestions", canGenerate: true },
  { id: "anthropic", name: "Anthropic (Claude)", connection: "Available for task suggestions", canGenerate: true },
  { id: "google", name: "Google Gemini", connection: "Available for task suggestions", canGenerate: true },
  { id: "openrouter", name: "OpenRouter", connection: "Secure key storage; generation integration coming later", canGenerate: false },
  { id: "groq", name: "Groq", connection: "Secure key storage; generation integration coming later", canGenerate: false },
  { id: "xai", name: "xAI", connection: "Secure key storage; generation integration coming later", canGenerate: false },
  { id: "deepseek", name: "DeepSeek", connection: "Secure key storage; generation integration coming later", canGenerate: false },
  { id: "mistral", name: "Mistral", connection: "Secure key storage; generation integration coming later", canGenerate: false },
  { id: "perplexity", name: "Perplexity", connection: "Secure key storage; generation integration coming later", canGenerate: false },
] as const;
export type AiProviderId = typeof AI_PROVIDERS[number]["id"];
export type Detection = {provider: AiProviderId | null; certainty: "likely" | "ambiguous" | "unknown"; description: string};

/** Hint only, never authentication. Do not send a key to multiple endpoints to guess its owner. */
export function detectAiProvider(raw: string): Detection {
  const key = raw.trim();
  if (!key) return {provider:null,certainty:"unknown",description:"Paste an API key to identify its provider."};
  if (/^sk-ant-(?:api\d+-)?/i.test(key)) return {provider:"anthropic",certainty:"likely",description:"Looks like an Anthropic Claude key."};
  if (/^sk-or-/i.test(key)) return {provider:"openrouter",certainty:"likely",description:"Looks like an OpenRouter key."};
  if (/^gsk_/i.test(key)) return {provider:"groq",certainty:"likely",description:"Looks like a Groq key."};
  if (/^sk-(?:proj|svcacct)-/i.test(key)) return {provider:"openai",certainty:"likely",description:"Looks like an OpenAI project/service key."};
  if (/^AIza/.test(key)) return {provider:"google",certainty:"likely",description:"Looks like a Google API key (not proof it has Gemini access)."};
  if (/^xai-/i.test(key)) return {provider:"xai",certainty:"likely",description:"Looks like an xAI key."};
  if (/^pplx-/i.test(key)) return {provider:"perplexity",certainty:"likely",description:"Looks like a Perplexity key."};
  if (/^sk-/.test(key)) return {provider:null,certainty:"ambiguous",description:"Several AI services use sk- keys. Select the provider manually."};
  return {provider:null,certainty:"unknown",description:"Can't recognize this key format. Select the provider manually."};
}

export function isAiProvider(value: unknown): value is AiProviderId {
  return typeof value === "string" && AI_PROVIDERS.some((p)=>p.id===value);
}

import type { EngineSettings, FreeProvider } from "@/lib/engine";

export type KeyProvider = {
  id: FreeProvider;
  field: "groqKey" | "geminiKey" | "openrouterKey" | "nvidiaKey";
  name: string;
  url: string;
  free: string;
  placeholder: string;
  /** What a real key looks like, used to recognise a pasted key. */
  pattern: RegExp;
};

export const KEY_PROVIDERS: KeyProvider[] = [
  { id: "groq", field: "groqKey", name: "Groq", url: "https://console.groq.com/keys", free: "Free tier, very fast (GPT-OSS 120B).", placeholder: "gsk_...", pattern: /^gsk_[A-Za-z0-9]{20,}$/ },
  { id: "gemini", field: "geminiKey", name: "Gemini", url: "https://aistudio.google.com/apikey", free: "Free tier in Google AI Studio (2.5 Flash).", placeholder: "AIza...", pattern: /^AIza[0-9A-Za-z_-]{30,}$/ },
  { id: "openrouter", field: "openrouterKey", name: "OpenRouter", url: "https://openrouter.ai/keys", free: "Has free models (Llama 3.3 70B).", placeholder: "sk-or-...", pattern: /^sk-or-[A-Za-z0-9_-]{20,}$/ },
  { id: "nvidia", field: "nvidiaKey", name: "NVIDIA NIM", url: "https://build.nvidia.com/settings/api-keys", free: "Free credits (Llama 3.1 70B).", placeholder: "nvapi-...", pattern: /^nvapi-[A-Za-z0-9_-]{20,}$/ },
];

/** Strips quotes, whitespace and a leading "Bearer " from something pasted. */
export function cleanKey(text: string): string {
  return text.trim().replace(/^bearer\s+/i, "").replace(/^["'`]+|["'`]+$/g, "").trim();
}

/** Which provider a pasted key belongs to, or null if it isn't recognisable. */
export function detectProvider(text: string): KeyProvider | null {
  const key = cleanKey(text);
  return KEY_PROVIDERS.find((p) => p.pattern.test(key)) ?? null;
}

export function providerById(id: string): KeyProvider | undefined {
  return KEY_PROVIDERS.find((p) => p.id === id);
}

/** How many of the four free providers have a key entered. */
export function keyCount(s: Pick<EngineSettings, "groqKey" | "geminiKey" | "openrouterKey" | "nvidiaKey">): number {
  return [s.groqKey, s.geminiKey, s.openrouterKey, s.nvidiaKey].filter((k) => k.trim()).length;
}

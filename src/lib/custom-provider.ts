/** A user-defined OpenAI-compatible provider (Hugging Face, Mistral, Cerebras, LM Studio, …). */
export const CUSTOM_PRESETS: { id: string; label: string; baseUrl: string; model: string; keyUrl: string; note: string }[] = [
  { id: "hf", label: "Hugging Face", baseUrl: "https://router.huggingface.co/v1", model: "Qwen/Qwen2.5-7B-Instruct", keyUrl: "https://huggingface.co/settings/tokens", note: "Small monthly free allowance, then paid." },
  { id: "mistral", label: "Mistral", baseUrl: "https://api.mistral.ai/v1", model: "mistral-small-latest", keyUrl: "https://console.mistral.ai/api-keys", note: "Free tier with rate limits." },
  { id: "cerebras", label: "Cerebras", baseUrl: "https://api.cerebras.ai/v1", model: "llama3.1-8b", keyUrl: "https://cloud.cerebras.ai", note: "Free tier with rate limits." },
];

const PRIVATE_HOST = /^(localhost|.*\.local|.*\.internal|.*\.lan|[^.]+)$/i;

function privateIp(host: string): boolean {
  const v4 = /^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/.exec(host);
  if (v4) {
    const [a, b] = [Number(v4[1]), Number(v4[2])];
    return a === 10 || a === 127 || a === 0 || (a === 169 && b === 254) || (a === 172 && b >= 16 && b <= 31) || (a === 192 && b === 168) || (a === 100 && b >= 64 && b <= 127);
  }
  return host.includes(":"); // any IPv6 literal: treat as private
}

/**
 * Checks a base URL the server is about to call on the user's behalf. Public https hosts only, unless the server owner
 * set ALLOW_PRIVATE_CUSTOM=1 (for LM Studio, vLLM or another box on the LAN). Returns the cleaned URL or an error.
 */
export function validateCustomUrl(input: unknown, allowPrivate = false): { ok: true; url: string } | { ok: false; error: string } {
  if (typeof input !== "string" || !input.trim()) return { ok: false, error: "Enter the provider's base URL." };
  let u: URL;
  try { u = new URL(input.trim()); } catch { return { ok: false, error: "That isn't a valid URL." }; }
  if (u.username || u.password) return { ok: false, error: "Don't put a key or password in the URL." };
  if (u.protocol !== "https:" && !(allowPrivate && u.protocol === "http:")) return { ok: false, error: allowPrivate ? "Use http:// or https://." : "Use an https:// address." };
  const host = u.hostname.replace(/^\[|\]$/g, "");
  if (!allowPrivate && (PRIVATE_HOST.test(host) || privateIp(host))) return { ok: false, error: "That looks like a private or local address. The server owner can allow these with ALLOW_PRIVATE_CUSTOM=1." };
  return { ok: true, url: u.toString().replace(/\/+$/, "") };
}

/** Model ids look like `Qwen/Qwen2.5-7B-Instruct`, `mistral-small-latest` or `llama3.1-8b:free`. */
export const isCustomModel = (m: unknown): m is string => typeof m === "string" && m.length > 0 && m.length <= 160 && /^[A-Za-z0-9][A-Za-z0-9._:/@+-]*$/.test(m);

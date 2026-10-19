import { cleanKey, providerById } from "@/lib/key-providers";
import { validateCustomUrl } from "@/lib/custom-provider";

const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });

type Check = { url: string; headers: (key: string) => Record<string, string> };
const CHECKS: Record<string, Check> = {
  groq: { url: "https://api.groq.com/openai/v1/models", headers: (k) => ({ authorization: `Bearer ${k}` }) },
  openrouter: { url: "https://openrouter.ai/api/v1/auth/key", headers: (k) => ({ authorization: `Bearer ${k}` }) },
  nvidia: { url: "https://integrate.api.nvidia.com/v1/models", headers: (k) => ({ authorization: `Bearer ${k}` }) },
  anthropic: { url: "https://api.anthropic.com/v1/models?limit=1", headers: (k) => ({ "x-api-key": k, "anthropic-version": "2023-06-01" }) },
  gemini: { url: "https://generativelanguage.googleapis.com/v1beta/models?pageSize=1", headers: (k) => ({ "x-goog-api-key": k }) },
};

/** POST { provider, key }. Makes one free "list models" request to confirm the key is accepted. Nothing is stored. */
export async function handleKeyTest(request: Request): Promise<Response> {
  let body: { provider?: unknown; key?: unknown; baseUrl?: unknown } = {};
  try { body = (await request.json()) as typeof body; } catch { return json({ ok: false, message: "Bad request." }, 400); }
  if (body.provider === "custom") {
    const url = validateCustomUrl(body.baseUrl, process.env["ALLOW_PRIVATE_CUSTOM"] === "1");
    if (!url.ok) return json({ ok: false, message: url.error }, 400);
    const key = typeof body.key === "string" ? cleanKey(body.key) : "";
    try {
      const res = await fetch(`${url.url}/models`, { headers: key ? { authorization: `Bearer ${key}` } : {}, signal: AbortSignal.timeout(10_000) });
      if (res.ok) return json({ ok: true, message: "Works." });
      if (res.status === 401 || res.status === 403) return json({ ok: false, message: "The provider rejected this key." });
      return json({ ok: false, message: `The provider answered ${res.status} (some providers don't list models; try a message instead).` });
    } catch {
      return json({ ok: false, message: "Couldn't reach that address from the server." });
    }
  }
  const provider = typeof body.provider === "string" ? providerById(body.provider) : undefined;
  const key = typeof body.key === "string" ? cleanKey(body.key) : "";
  const check = provider ? CHECKS[provider.id] : undefined;
  if (!provider || !check) return json({ ok: false, message: "Unknown provider." }, 400);
  if (!key || key.length > 300) return json({ ok: false, message: "Enter a key first." }, 400);
  try {
    const res = await fetch(check.url, { headers: check.headers(key), signal: AbortSignal.timeout(10_000) });
    if (res.ok) return json({ ok: true, message: "Works." });
    if (res.status === 401 || res.status === 403 || res.status === 400) return json({ ok: false, message: `${provider.name} rejected this key.` });
    if (res.status === 429) return json({ ok: true, message: "Key is valid (rate limited right now)." });
    return json({ ok: false, message: `${provider.name} answered ${res.status}.` });
  } catch {
    return json({ ok: false, message: `Couldn't reach ${provider.name} from the server.` });
  }
}

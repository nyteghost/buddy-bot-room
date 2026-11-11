/**
 * Private Strata inference adapter (source-only preview).
 *
 * No active application route calls this until the separate local-only routing review.
 * Configuration is server-owned, read lazily, and OFF by default. Never log secrets.
 * This is NOT an Ollama endpoint: Strata uses OpenAI-compatible /v1 APIs.
 */
export class StrataError extends Error {
  constructor(
    readonly code: "disabled" | "config" | "auth" | "busy" | "offline" | "model" | "response",
    message: string,
  ) {
    super(message);
    this.name = "StrataError";
  }
}

export type StrataModel = Readonly<{ id: string; status?: string }>;
export type StrataMessage = Readonly<{ role: "system" | "user" | "assistant"; content: string }>;
export type StrataReply = Readonly<{ text: string; model: string; truncated: boolean; finishReason: string }>;
const MODEL_RE = /^[A-Za-z0-9][A-Za-z0-9._:/@+-]{0,159}$/;
const MAX_BYTES = 256 * 1024;

const ipv4 = (host: string): number[] | null => {
  if (!/^(?:\d{1,3}\.){3}\d{1,3}$/.test(host)) return null;
  const parts = host.split(".").map(Number);
  return parts.length === 4 && parts.every((n) => Number.isInteger(n) && n >= 0 && n <= 255) ? parts : null;
};

/** Only literal private IPv4, Tailscale CGNAT, or loopback. DNS cannot rebind. */
export function strataPrivateBase(candidate: string): string | null {
  try {
    const url = new URL(candidate.trim());
    const parts = ipv4(url.hostname);
    if (!parts) return null;
    const [a = -1, b = -1] = parts;
    const privateIp = a === 10 || (a === 172 && b >= 16 && b <= 31) ||
      (a === 192 && b === 168) || (a === 100 && b >= 64 && b <= 127) || a === 127;
    if (!privateIp || !["http:", "https:"].includes(url.protocol) ||
      !url.port || url.username || url.password || url.search || url.hash ||
      !["", "/", "/v1", "/v1/"].includes(url.pathname)) return null;
    return `${url.protocol}//${url.host}/v1`;
  } catch {
    return null;
  }
}

function config(): Readonly<{ base: string; key: string; model: string }> {
  if (process.env["STRATA_ENABLED"] !== "on")
    throw new StrataError("disabled", "Strata is not enabled in Settings.");
  const base = strataPrivateBase(process.env["STRATA_URL"] ?? "");
  const key = process.env["STRATA_API_KEY"] ?? "";
  const model = (process.env["STRATA_MODEL"] ?? "").trim();
  if (!base || !key.trim() || /[\r\n]/.test(key))
    throw new StrataError("config", "Private Strata connection is not configured.");
  return { base, key, model };
}

export function strataConfigured(): boolean {
  try { config(); return true; } catch { return false; }
}

/** Read bounded JSON, including chunked responses that do not advertise a length. */
async function boundedJson(response: Response): Promise<Record<string, unknown>> {
  const len = Number(response.headers.get("content-length") ?? "0");
  if (len > MAX_BYTES) throw new StrataError("response", "Strata response exceeded size limit.");
  const reader = response.body?.getReader();
  if (!reader) throw new StrataError("response", "Strata returned an empty response.");
  let total = 0;
  const chunks: Uint8Array[] = [];
  try {
    while (true) {
      const { value, done } = await reader.read();
      if (done) break;
      total += value.byteLength;
      if (total > MAX_BYTES) throw new StrataError("response", "Strata response exceeded size limit.");
      chunks.push(value);
    }
  } finally { reader.releaseLock(); }
  const bytes = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.byteLength; }
  try {
    const parsed: unknown = JSON.parse(new TextDecoder().decode(bytes));
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed))
      throw new Error("Not a JSON object");
    return parsed as Record<string, unknown>;
  } catch {
    throw new StrataError("response", "Strata returned invalid JSON.");
  }
}

async function request(
  path: "/models" | "/chat/completions",
  body?: unknown,
  fetcher: typeof fetch = fetch,
  timeoutMs = 15_000,
): Promise<Record<string, unknown>> {
  const { base, key } = config();
  let response: Response;
  try {
    response = await fetcher(base + path, {
      method: body === undefined ? "GET" : "POST",
      headers: {
        Authorization: `Bearer ${key}`,
        Accept: "application/json",
        ...(body === undefined ? {} : { "Content-Type": "application/json" }),
      },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
      cache: "no-store",
      redirect: "error",
      signal: AbortSignal.timeout(Math.min(120_000, Math.max(500, timeoutMs))),
    });
  } catch {
    throw new StrataError("offline", "Strata is unreachable from the application server.");
  }
  if (response.status === 401 || response.status === 403)
    throw new StrataError("auth", "Strata rejected the configured API key.");
  if (response.status === 429)
    throw new StrataError("busy", "Strata is busy. Please retry.");
  if (response.status === 404)
    throw new StrataError("model", "Strata endpoint or model is unavailable.");
  if (!response.ok)
    throw new StrataError("offline", "Strata could not complete the local request.");
  return boundedJson(response);
}

export async function strataModels(fetcher: typeof fetch = fetch): Promise<StrataModel[]> {
  const data = await request("/models", undefined, fetcher, 8000);
  if (!Array.isArray(data["data"]))
    throw new StrataError("response", "Strata returned an invalid model list.");
  return data["data"].slice(0, 50).flatMap((entry: unknown): StrataModel[] => {
    if (!entry || typeof entry !== "object") return [];
    const m = entry as { id?: unknown; status?: { value?: unknown } };
    if (typeof m.id !== "string" || !MODEL_RE.test(m.id)) return [];
    const status = typeof m.status?.value === "string" ? m.status.value : undefined;
    return [status ? { id: m.id, status } : { id: m.id }];
  });
}

export async function strataChat(
  messages: readonly StrataMessage[],
  modelOverride?: string,
  fetcher: typeof fetch = fetch,
): Promise<StrataReply> {
  const { model: configured } = config();
  const model = (modelOverride ?? configured).trim();
  if (!MODEL_RE.test(model)) throw new StrataError("model", "Select an installed Strata model.");
  if (!messages.length || messages.length > 80 ||
    messages.some(m => !["system", "user", "assistant"].includes(m.role) ||
      typeof m.content !== "string" || !m.content.trim() || m.content.length > 20_000))
    throw new StrataError("response", "The requested local conversation is invalid.");
  const data = await request("/chat/completions",
    { model, messages, max_tokens: 1024, stream: false }, fetcher, 120_000);
  const choices = data["choices"];
  const choice = Array.isArray(choices) ? choices[0] as Record<string, unknown> | undefined : undefined;
  const message = choice && typeof choice["message"] === "object" && choice["message"]
    ? choice["message"] as Record<string, unknown> : undefined;
  const text = message?.["content"];
  if (typeof text !== "string" || !text.trim())
    throw new StrataError("response", "Strata returned no readable answer.");
  const finishReason = typeof choice?.["finish_reason"] === "string" ? choice["finish_reason"] : "unknown";
  return { text: text.slice(0, 12_000), model, truncated: finishReason === "length", finishReason };
}

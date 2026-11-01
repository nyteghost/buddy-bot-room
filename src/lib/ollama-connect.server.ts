import { currentUser } from "./accounts.server";
import { ensureSettings, saveSettings } from "./settings.server";
import { isModelName } from "./model-catalog";
import { ollamaConnectUrl } from "./ollama-connect";
const reply = (data: unknown, status = 200) => Response.json(data, { status, headers: { "Cache-Control": "no-store" } });
async function installed(url: string, signal: AbortSignal): Promise<string[]> {
  const response = await fetch(`${url}/api/tags`, { method: "GET", redirect: "error", headers: { Accept: "application/json" }, signal });
  if (!response.ok) { await response.body?.cancel(); throw new Error("unavailable"); }
  const reader = response.body?.getReader(); if (!reader) throw new Error("empty");
  let text = "", size = 0; const decoder = new TextDecoder();
  try {
    for (;;) { const chunk = await reader.read(); if (chunk.done) break; size += chunk.value.byteLength; if (size > 200000) throw new Error("large"); text += decoder.decode(chunk.value, { stream: true }); }
    text += decoder.decode();
    const json: unknown = JSON.parse(text);
    if (!json || typeof json !== "object" || !Array.isArray((json as { models?: unknown }).models)) throw new Error("not Ollama");
    return [...new Set(((json as { models: unknown[] }).models).slice(0, 300).flatMap(row => {
      if (!row || typeof row !== "object") return [];
      const r = row as { name?: unknown; remote_host?: unknown };
      return isModelName(r.name) && !/(?:[:\-]cloud)$/i.test(r.name) && !r.remote_host ? [r.name] : [];
    }))];
  } finally { await reader.cancel().catch(() => undefined); }
}
export async function handleOllamaConnect(request: Request): Promise<Response> {
  if (!(await currentUser(request))?.owner) return reply({ error: "Sign in as the owner to connect Ollama." }, 403);
  await ensureSettings();
  if (request.method === "GET") return reply({ configured: !!process.env["OLLAMA_URL"]?.trim() });
  if (request.method !== "POST") return reply({ error: "Method not allowed" }, 405);
  let input: { op?: unknown; url?: unknown; model?: unknown };
  try { const raw = await request.text(); if (raw.length > 4000) return reply({ error: "Request too large" }, 413); input = JSON.parse(raw); if (!input || typeof input !== "object") throw new Error(); }
  catch { return reply({ error: "Invalid connection request" }, 400); }
  if (input.op !== "test" && input.op !== "connect") return reply({ error: "Choose test or connect" }, 400);
  const url = ollamaConnectUrl(input.url);
  if (!url) return reply({ error: "Enter an HTTP or HTTPS Ollama address without a password, query or fragment, such as http://your-pc-ip:11434." }, 400);
  if (request.signal.aborted) return reply({ error: "Cancelled" }, 499);
  try {
    const models = await installed(url, AbortSignal.any([request.signal, AbortSignal.timeout(6000)]));
    if (request.signal.aborted) return reply({ error: "Cancelled" }, 499);
    if (input.op === "connect") {
      if (!isModelName(input.model) || !models.includes(input.model)) return reply({ error: "Select an installed local model, then try again. Nothing was saved.", models, url }, 400);
      const result = await saveSettings({ OLLAMA_URL: url });
      if (Object.keys(result.errors).length || !result.saved.includes("OLLAMA_URL")) return reply({ error: "Connection worked, but the address could not be saved. Check the Pixel Pals data volume." }, 500);
      return reply({ ok: true, saved: true, url, models, model: input.model });
    }
    return reply({ ok: true, saved: false, url, models, note: models.length ? "Unraid reached Ollama. Choose a model and save to finish." : "Ollama is reachable, but has no installed local models. Run ollama list on your PC and install a local model first." });
  } catch {
    return request.signal.aborted ? reply({ error: "Cancelled" }, 499) : reply({ error: "Pixel Pals could not reach Ollama from its server. Check the PC address, that Ollama is running and listening on the network, and the PC firewall. Your saved connection was not changed." }, 502);
  }
}

import { readHardware } from "@/lib/hardware.server";
import { isModelName } from "@/lib/model-catalog";
import { logServer } from "./server-log.server";

const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });

/** The Ollama inside the stack (or any address you give it). Empty means Local AI is not set up. */
export const ollamaBase = (): string => (process.env["OLLAMA_URL"] ?? "").trim().replace(/\/+$/, "");

async function ollama(path: string, init: RequestInit & { timeout?: number } = {}): Promise<Response> {
  const { timeout = 5000, ...rest } = init;
  return fetch(`${ollamaBase()}${path}`, { ...rest, signal: init.signal ?? AbortSignal.timeout(timeout) });
}

type Tag = { name: string; size?: number };

/** GET: status, installed models and the machine's hardware. POST {action:"pull"|"delete", model}: download or remove a model. */
export async function handleOllamaApi(request: Request): Promise<Response> {
  if (!ollamaBase()) return json({ configured: false });
  if (request.method === "GET") {
    const hardware = await readHardware();
    try {
      const [tags, ps] = await Promise.all([ollama("/api/tags"), ollama("/api/ps").catch(() => null)]);
      if (!tags.ok) return json({ configured: true, reachable: false, hardware, error: `Ollama answered ${tags.status}.` });
      const models = ((await tags.json()) as { models?: Tag[] }).models ?? [];
      const loaded = ps?.ok ? (((await ps.json()) as { models?: { name: string; size_vram?: number; size?: number }[] }).models ?? []) : [];
      return json({
        configured: true,
        reachable: true,
        hardware,
        models: models.map((m) => ({ name: m.name, gb: Math.round(((m.size ?? 0) / 1024 ** 3) * 10) / 10 })),
        loaded: loaded.map((m) => ({ name: m.name, onGpu: (m.size_vram ?? 0) > 0 })),
      });
    } catch {
      return json({ configured: true, reachable: false, hardware, error: "Couldn't reach Ollama. Is the ollama container running?" });
    }
  }
  if (request.method !== "POST") return json({ error: "Method not allowed." }, 405);
  let body: { action?: unknown; model?: unknown } = {};
  try { body = (await request.json()) as typeof body; } catch { return json({ error: "Bad request." }, 400); }
  if (!isModelName(body.model)) return json({ error: "That isn't a valid model name." }, 400);
  if (body.action === "pull") {
    try {
      const res = await ollama("/api/pull", { method: "POST", body: JSON.stringify({ model: body.model, stream: true }), headers: { "content-type": "application/json" }, timeout: 60 * 60_000 });
      if (!res.ok || !res.body) return json({ error: `Ollama couldn't download ${body.model} (${res.status}).` }, 502);
      logServer("info", `ollama pull started: ${body.model}`);
      return new Response(res.body, { headers: { "content-type": "application/x-ndjson", "cache-control": "no-store" } });
    } catch {
      return json({ error: "Couldn't reach Ollama." }, 502);
    }
  }
  if (body.action === "delete") {
    try {
      const res = await ollama("/api/delete", { method: "DELETE", body: JSON.stringify({ model: body.model }), headers: { "content-type": "application/json" } });
      return res.ok ? json({ ok: true }) : json({ error: `Ollama couldn't remove ${body.model}.` }, 502);
    } catch {
      return json({ error: "Couldn't reach Ollama." }, 502);
    }
  }
  return json({ error: "Unknown action." }, 400);
}

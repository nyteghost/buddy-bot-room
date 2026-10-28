import { ollamaBase } from "./ollama.server";

const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });
export const embedModel = () => (process.env["OLLAMA_EMBED_MODEL"] ?? "nomic-embed-text").trim() || "nomic-embed-text";

/** POST { texts: string[] } -> { embeddings: number[][] } using the stack's Ollama. */
export async function handleEmbed(request: Request): Promise<Response> {
  if (!ollamaBase()) return json({ error: "Local AI isn't set up." }, 503);
  let body: { texts?: unknown } = {};
  try { body = (await request.json()) as typeof body; } catch { return json({ error: "Bad request." }, 400); }
  const texts = Array.isArray(body.texts) ? body.texts : [];
  if (!texts.length || texts.length > 40 || texts.some((t) => typeof t !== "string" || t.length > 4000)) return json({ error: "Send 1 to 40 texts of up to 4000 characters." }, 400);
  try {
    const res = await fetch(`${ollamaBase()}/api/embed`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ model: embedModel(), input: texts }), signal: AbortSignal.timeout(60_000) });
    if (res.status === 404) return json({ error: `The embedding model ${embedModel()} isn't downloaded. Download it in the Local AI panel (More models) or add it to OLLAMA_MODELS.` }, 503);
    if (!res.ok) return json({ error: `Ollama answered ${res.status}.` }, 502);
    const data = (await res.json()) as { embeddings?: number[][] };
    return data.embeddings?.length === texts.length ? json({ embeddings: data.embeddings, model: embedModel() }) : json({ error: "Unexpected answer from Ollama." }, 502);
  } catch {
    return json({ error: "Couldn't reach Ollama." }, 502);
  }
}

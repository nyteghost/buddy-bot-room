import type { Chunk } from "./rag";
import { retrieve } from "./rag";
import { hybridRetrieve, type Embedder } from "./embed-cache";
import { idbStore } from "./embed-store";

let unavailableUntil = 0;

const embedder: Embedder = async (texts) => {
  const res = await fetch("/api/embed", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ texts }), signal: AbortSignal.timeout(20_000) });
  if (!res.ok) throw new Error(String(res.status));
  const { embeddings, model } = (await res.json()) as { embeddings: number[][]; model?: string };
  return { embeddings, model: model ?? "unknown" };
};

/**
 * Best passages for a question: keyword ranking fused with meaning ranking (embeddings from your Local AI / Ollama).
 * Each passage is embedded once per embedding model and kept in this browser, so repeat questions only embed the question.
 * Falls back to keyword search when Local AI is unavailable.
 */
export async function smartRetrieve(chunks: Chunk[], query: string, k = 4): Promise<Chunk[]> {
  if (chunks.length <= k || Date.now() < unavailableUntil) return retrieve(chunks, query, k);
  try {
    return await hybridRetrieve(chunks, query, k, { embed: embedder, store: idbStore() });
  } catch {
    unavailableUntil = Date.now() + 5 * 60_000; // don't retry on every message
    return retrieve(chunks, query, k);
  }
}

import type { Chunk } from "./rag";
import { retrieve } from "./rag";
import { candidateChunks, rerank } from "./embed-rerank";

let unavailableUntil = 0;

/**
 * Best passages for a question. Uses embeddings from your Local AI (Ollama) to rank by meaning when it is available,
 * and quietly falls back to keyword search otherwise.
 */
export async function smartRetrieve(chunks: Chunk[], query: string, k = 4): Promise<Chunk[]> {
  if (chunks.length <= k || Date.now() < unavailableUntil) return retrieve(chunks, query, k);
  try {
    const candidates = candidateChunks(chunks, query);
    const res = await fetch("/api/embed", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ texts: [query, ...candidates.map((c) => c.text.slice(0, 1500))] }), signal: AbortSignal.timeout(20_000) });
    if (!res.ok) throw new Error(String(res.status));
    const { embeddings } = (await res.json()) as { embeddings: number[][] };
    const [q, ...rest] = embeddings;
    if (!q) throw new Error("empty");
    return rerank(candidates, q, rest, k);
  } catch {
    unavailableUntil = Date.now() + 5 * 60_000; // don't retry on every message
    return retrieve(chunks, query, k);
  }
}

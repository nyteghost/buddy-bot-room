import type { Chunk } from "./rag";
import { retrieve } from "./rag";

export function cosine(a: number[], b: number[]): number {
  let dot = 0, na = 0, nb = 0;
  const n = Math.min(a.length, b.length);
  for (let i = 0; i < n; i++) { const x = a[i] ?? 0, y = b[i] ?? 0; dot += x * y; na += x * x; nb += y * y; }
  return na && nb ? dot / Math.sqrt(na * nb) : 0;
}

/** Keyword matches first, topped up with the remaining chunks in order so synonyms can still be found. */
export function candidateChunks(chunks: Chunk[], query: string, max = 24): Chunk[] {
  const lexical = retrieve(chunks, query, Math.min(12, max));
  const seen = new Set(lexical);
  const out = [...lexical];
  for (const c of chunks) {
    if (out.length >= max) break;
    if (!seen.has(c)) { out.push(c); seen.add(c); }
  }
  return out;
}

/** Orders candidates by meaning (embedding similarity) and keeps the best k. Needs one vector per candidate. */
export function rerank(candidates: Chunk[], queryVec: number[], vecs: number[][], k = 4): Chunk[] {
  if (vecs.length !== candidates.length) return candidates.slice(0, k);
  return candidates
    .map((c, i) => ({ c, s: cosine(queryVec, vecs[i] ?? []) }))
    .sort((a, b) => b.s - a.s)
    .slice(0, k)
    .map((x) => x.c);
}

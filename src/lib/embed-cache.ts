import type { Chunk } from "./rag";
import { retrieve } from "./rag";
import { cosine } from "./embed-rerank";

/** Fast stable 53-bit string hash (works on plain-http pages, where crypto.subtle is missing). */
export function hashText(s: string): string {
  let h1 = 0xdeadbeef, h2 = 0x41c6ce57;
  for (let i = 0; i < s.length; i++) {
    const ch = s.charCodeAt(i);
    h1 = Math.imul(h1 ^ ch, 2654435761);
    h2 = Math.imul(h2 ^ ch, 1597334677);
  }
  h1 = Math.imul(h1 ^ (h1 >>> 16), 2246822507) ^ Math.imul(h2 ^ (h2 >>> 13), 3266489909);
  h2 = Math.imul(h2 ^ (h2 >>> 16), 2246822507) ^ Math.imul(h1 ^ (h1 >>> 13), 3266489909);
  return (4294967296 * (2097151 & h2) + (h1 >>> 0)).toString(36);
}

/** The passage text that gets embedded (and hashed), so the cache key follows the content, not the file name or position. */
export const embedText = (c: Chunk): string => c.text.slice(0, 1500);
/** Cache key: the same text under a different embedding model is a different vector. */
export const vecKey = (model: string, text: string): string => `${model}|${hashText(text)}`;

export type VecStore = {
  get(keys: string[]): Promise<Map<string, number[]>>;
  put(entries: [string, number[]][]): Promise<void>;
  getModel(): Promise<string>;
  setModel(model: string): Promise<void>;
};
export type Embedder = (texts: string[]) => Promise<{ model: string; embeddings: number[][] }>;

export function memoryStore(): VecStore & { size(): number } {
  const m = new Map<string, number[]>();
  let model = "";
  return {
    async get(keys) { const out = new Map<string, number[]>(); for (const k of keys) { const v = m.get(k); if (v) out.set(k, v); } return out; },
    async put(entries) { for (const [k, v] of entries) m.set(k, v); },
    async getModel() { return model; },
    async setModel(x) { model = x; },
    size: () => m.size,
  };
}

/** Which passages to send for embedding: the best keyword matches, then passages that are already cached (free),
 *  then a few uncached ones spread evenly across the whole collection (so late passages are not left out). */
export function pickCandidates(chunks: Chunk[], query: string, has: (i: number) => boolean, opts = { lexical: 12, total: 24, fresh: 12 }): number[] {
  const index = new Map(chunks.map((c, i) => [c, i]));
  const picked: number[] = [];
  const seen = new Set<number>();
  const add = (i: number | undefined) => { if (i !== undefined && !seen.has(i) && picked.length < opts.total) { seen.add(i); picked.push(i); } };
  for (const c of retrieve(chunks, query, opts.lexical)) add(index.get(c));
  for (let i = 0; i < chunks.length; i++) if (has(i)) add(i);
  const rest = chunks.map((_, i) => i).filter((i) => !seen.has(i));
  const fresh = Math.min(opts.fresh, opts.total - picked.length, rest.length);
  for (let n = 0; n < fresh; n++) add(rest[Math.floor(((n + 0.5) * rest.length) / fresh)]);
  return picked;
}

/** Reciprocal-rank fusion of the keyword ranking and the meaning ranking, so neither one alone can bury a good passage. */
export function fuse(chunks: Chunk[], keywordOrder: Chunk[], semanticOrder: Chunk[], k: number): Chunk[] {
  const score = new Map<Chunk, number>();
  const add = (list: Chunk[]) => list.forEach((c, r) => score.set(c, (score.get(c) ?? 0) + 1 / (60 + r)));
  add(keywordOrder); add(semanticOrder);
  return chunks.filter((c) => score.has(c)).sort((a, b) => (score.get(b) ?? 0) - (score.get(a) ?? 0)).slice(0, k);
}

export type RetrieveStats = { embedded: number; cached: number; calls: number };

/** Hybrid retrieval with a persistent embedding cache: each passage is embedded once per model; repeat questions only embed the question. */
export async function hybridRetrieve(chunks: Chunk[], query: string, k: number, deps: { embed: Embedder; store: VecStore; stats?: RetrieveStats }): Promise<Chunk[]> {
  const { embed, store } = deps;
  const stats = deps.stats ?? { embedded: 0, cached: 0, calls: 0 };
  let model = await store.getModel();
  const lookup = async (m: string) => store.get(chunks.map((c) => vecKey(m, embedText(c))));
  let cache = model ? await lookup(model) : new Map<string, number[]>();
  const have = (i: number) => cache.has(vecKey(model, embedText(chunks[i]!)));
  const chosen = pickCandidates(chunks, query, have);
  const missing = chosen.filter((i) => !have(i));
  // One request carries the question plus every passage that still needs a vector.
  const res = await embed([query, ...missing.map((i) => embedText(chunks[i]!))]);
  stats.calls++; stats.embedded += missing.length;
  const [qv, ...fresh] = res.embeddings;
  if (!qv || fresh.length !== missing.length) throw new Error("embedding answer did not match the request");
  if (res.model !== model) { // first use, or the embedding model was changed: vectors made by an older model don't apply
    model = res.model;
    await store.setModel(model);
    cache = await lookup(model);
  }
  const keep = async (idx: number[], vectors: number[][]) => {
    const rows: [string, number[]][] = idx.map((i, n) => [vecKey(model, embedText(chunks[i]!)), vectors[n]!]);
    await store.put(rows);
    for (const [key, v] of rows) cache.set(key, v);
  };
  await keep(missing, fresh);
  const stale = chosen.filter((i) => !have(i)); // only after a model change: passages we thought were cached under the old model
  if (stale.length) {
    const again = await embed(stale.map((i) => embedText(chunks[i]!)));
    stats.calls++; stats.embedded += stale.length;
    if (again.embeddings.length !== stale.length) throw new Error("embedding answer did not match the request");
    await keep(stale, again.embeddings);
  }
  const vecs = chosen.map((i) => cache.get(vecKey(model, embedText(chunks[i]!))));
  stats.cached += chosen.length - missing.length - stale.length;
  const ranked = chosen.flatMap((i, n) => (vecs[n] ? [{ c: chunks[i]!, s: cosine(qv, vecs[n]!) }] : [])).sort((a, b) => b.s - a.s).map((x) => x.c);
  return fuse(chunks, retrieve(chunks, query, chunks.length), ranked, k);
}

import { describe, expect, it } from "vitest";
import { chunkText, retrieve, type Chunk } from "@/lib/rag";
import { embedText, fuse, hashText, hybridRetrieve, memoryStore, pickCandidates, vecKey, type Embedder, type RetrieveStats } from "@/lib/embed-cache";

const words = ["alpha", "bravo", "charlie", "delta", "echo", "foxtrot", "golf", "hotel"];
const make = (n: number): Chunk[] => Array.from({ length: n }, (_, i) => ({ doc: "d.txt", n: i + 1, text: `passage ${i} about ${words[i % words.length]} and topic${i}` }));
/** A tiny deterministic "embedder": a word-count vector, with a call log so tests can count the work. */
function fakeEmbedder(model = "m1") {
  const log: string[][] = [];
  const embed: Embedder = async (texts) => {
    log.push(texts);
    return { model, embeddings: texts.map((t) => [...words.map((w): number => (t.includes(w) ? 1 : 0)), t.length % 7]) };
  };
  return { embed, log, total: () => log.reduce((n, l) => n + l.length, 0) };
}

describe("embedding cache", () => {
  it("hashes by content, stably", () => {
    expect(hashText("same")).toBe(hashText("same"));
    expect(hashText("same")).not.toBe(hashText("other"));
    expect(vecKey("m1", "x")).not.toBe(vecKey("m2", "x"));
  });
  it("embeds each passage once: a repeat question only embeds the question", async () => {
    const chunks = make(60), store = memoryStore(), f = fakeEmbedder();
    await hybridRetrieve(chunks, "tell me about echo", 4, { embed: f.embed, store });
    const first = f.total();
    expect(first).toBeLessThanOrEqual(25);
    await hybridRetrieve(chunks, "tell me about echo", 4, { embed: f.embed, store });
    expect(f.total() - first).toBe(1);
  });
  it("reuses vectors after a 'restart' (new calls, same store) and for unchanged passages in an edited document", async () => {
    const chunks = make(40), store = memoryStore(), f = fakeEmbedder();
    await hybridRetrieve(chunks, "golf", 4, { embed: f.embed, store });
    const before = store.size();
    const edited = chunks.map((c, i) => (i === 0 ? { ...c, text: "completely new text" } : c));
    const stats: RetrieveStats = { embedded: 0, cached: 0, calls: 0 };
    await hybridRetrieve(edited, "golf", 4, { embed: f.embed, store, stats });
    expect(stats.cached).toBeGreaterThan(5);
    expect(store.size()).toBeGreaterThanOrEqual(before);
  });
  it("a different embedding model invalidates the old vectors", async () => {
    const chunks = make(30), store = memoryStore();
    const a = fakeEmbedder("m1"), b = fakeEmbedder("m2");
    await hybridRetrieve(chunks, "hotel", 4, { embed: a.embed, store });
    const stats: RetrieveStats = { embedded: 0, cached: 0, calls: 0 };
    await hybridRetrieve(chunks, "hotel", 4, { embed: b.embed, store, stats });
    expect(stats.cached).toBe(0);
    expect(await store.getModel()).toBe("m2");
  });
  it("does not leave late passages out: a match at the very end is found", async () => {
    const chunks = make(200);
    chunks[199] = { doc: "d.txt", n: 200, text: "the zebra enclosure opens at nine" };
    const out = await hybridRetrieve(chunks, "when does the zebra enclosure open", 4, { embed: fakeEmbedder().embed, store: memoryStore() });
    expect(out).toContain(chunks[199]);
  });
  it("spreads the uncached picks across the whole collection, not just the first ones", () => {
    const chunks = make(200);
    const idx = pickCandidates(chunks, "zzzz-no-match", () => false);
    expect(Math.max(...idx)).toBeGreaterThan(150);
    expect(idx.length).toBeLessThanOrEqual(24);
  });
  it("prefers passages that already have vectors before spending embeddings on new ones", () => {
    const chunks = make(100);
    const idx = pickCandidates(chunks, "zzzz-no-match", (i) => i >= 90, { lexical: 12, total: 24, fresh: 12 });
    for (let i = 90; i < 100; i++) expect(idx).toContain(i);
  });
  it("fusion keeps a keyword-only hit and a meaning-only hit", () => {
    const chunks = make(10);
    const out = fuse(chunks, [chunks[3]!, chunks[1]!], [chunks[7]!, chunks[1]!], 3);
    expect(out).toContain(chunks[3]);
    expect(out).toContain(chunks[7]);
    expect(out[0]).toBe(chunks[1]);
  });
  it("chunks and embed text stay in step (cache keys follow the text sent for embedding)", () => {
    const chunks = chunkText("a.txt", "x".repeat(2000));
    expect(embedText(chunks[0]!).length).toBeLessThanOrEqual(1500);
    expect(retrieve(chunks, "x", 1).length).toBeLessThanOrEqual(1);
  });
  it("surfaces an embedder failure so the caller can fall back to keyword search", async () => {
    const bad: Embedder = async () => { throw new Error("down"); };
    await expect(hybridRetrieve(make(30), "q", 4, { embed: bad, store: memoryStore() })).rejects.toThrow();
  });
});

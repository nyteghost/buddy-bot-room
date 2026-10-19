/** Document chat: chunk files, then pull the few passages that best match what you just asked. No AI needed. */
export type Chunk = { doc: string; n: number; text: string };
export type Doc = { name: string; text: string };

export const CHUNK_SIZE = 900;
export const TOP_K = 4;
export const MAX_DOC_CHARS = 120_000;
export const MAX_TOTAL_CHARS = 400_000;
const STOP = new Set("a an and are as at be but by for from has have he her his how i in is it its me my not of on or our she so than that the their them there they this to was we were what when where which who why will with you your".split(" "));

export const tokenize = (s: string): string[] => (s.toLowerCase().match(/[a-z0-9][a-z0-9'_-]*/g) ?? []).filter((w) => w.length > 1 && !STOP.has(w));

/** Splits on paragraph breaks, packing paragraphs up to CHUNK_SIZE; very long paragraphs are cut. */
export function chunkText(doc: string, text: string, size = CHUNK_SIZE): Chunk[] {
  const parts: string[] = [];
  let cur = "";
  const flush = () => { if (cur.trim()) parts.push(cur.trim()); cur = ""; };
  for (const para of text.replace(/\r\n/g, "\n").split(/\n{2,}/)) {
    let p = para.trim();
    if (!p) continue;
    while (p.length > size) { flush(); parts.push(p.slice(0, size)); p = p.slice(size); }
    if (cur && cur.length + p.length + 2 > size) flush();
    cur = cur ? `${cur}\n\n${p}` : p;
  }
  flush();
  return parts.map((t, i) => ({ doc, n: i + 1, text: t }));
}

/** Keyword score with inverse-document-frequency weighting (a light BM25-style ranking). */
export function retrieve(chunks: Chunk[], query: string, k = TOP_K): Chunk[] {
  const q = [...new Set(tokenize(query))];
  if (!q.length || !chunks.length) return [];
  const tokenized = chunks.map((c) => tokenize(c.text));
  const df = new Map<string, number>();
  for (const toks of tokenized) for (const w of new Set(toks)) df.set(w, (df.get(w) ?? 0) + 1);
  const N = chunks.length;
  const scored = chunks.map((c, i) => {
    const toks = tokenized[i] ?? [];
    const tf = new Map<string, number>();
    for (const w of toks) tf.set(w, (tf.get(w) ?? 0) + 1);
    let score = 0;
    for (const w of q) {
      const f = tf.get(w) ?? 0;
      if (!f) continue;
      const idf = Math.log(1 + (N - (df.get(w) ?? 0) + 0.5) / ((df.get(w) ?? 0) + 0.5));
      score += idf * ((f * 2.2) / (f + 1.2 * (0.25 + 0.75 * (toks.length / 150))));
    }
    return { c, score };
  });
  return scored.filter((s) => s.score > 0).sort((a, b) => b.score - a.score).slice(0, k).map((s) => s.c);
}

/** Text handed to the pals, labelled so they can cite "[file §n]". Capped. */
export function docContext(chunks: Chunk[], maxChars = 3600): string {
  let out = "";
  for (const c of chunks) {
    const block = `[${c.doc} §${c.n}]\n${c.text}\n\n`;
    if (out.length + block.length > maxChars) break;
    out += block;
  }
  return out.trim();
}

const OK_EXT = /\.(txt|md|markdown|csv|tsv|json|log|ya?ml|toml|ini|conf|xml|html?|css|js|jsx|ts|tsx|py|sh|fish|rs|go|java|c|cpp|h|sql|env)$/i;
export const isReadableDoc = (name: string): boolean => OK_EXT.test(name);

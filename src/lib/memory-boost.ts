import { smartRetrieve } from "./smart-docs";

/** Optional "related to the question" scores for memories (0..1 by rank), using the same keyword + meaning search as documents.
 *  Only called when there are more memories than fit in a prompt. Falls back to keyword matching when Local AI is not running. */
export async function memoryBoost(items: { id: string; text: string }[], query: string, k = 8): Promise<Map<string, number>> {
  const out = new Map<string, number>();
  if (!query.trim() || items.length <= k) return out;
  try {
    const top = await smartRetrieve(items.map((i) => ({ doc: i.id, n: 0, text: i.text })), query, k);
    top.forEach((c, r) => out.set(c.doc, 1 - r / (top.length + 1)));
  } catch { /* ranking still works without it */ }
  return out;
}

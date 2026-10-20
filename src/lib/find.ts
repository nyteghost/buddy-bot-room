/** Pure search across the things you keep in Pixel Pals. Every word you type must appear; titles count more; newer wins ties. */
export type Doc = { kind: "chat" | "note" | "todo" | "memory" | "reminder"; id: string; title: string; text: string; at: number };
export type Hit = { doc: Doc; snippet: string; score: number };

export const KIND_LABEL: Record<Doc["kind"], string> = { chat: "Chat", note: "Note", todo: "Task", memory: "Memory", reminder: "Reminder" };

const words = (q: string): string[] => q.toLowerCase().split(/\s+/).map((w) => w.replace(/^["']|["']$/g, "")).filter((w) => w.length > 0).slice(0, 8);

export function snippetAround(text: string, term: string, width = 110): string {
  const flat = text.replace(/\s+/g, " ").trim();
  const at = flat.toLowerCase().indexOf(term);
  if (at < 0 || flat.length <= width) return flat.slice(0, width);
  const start = Math.max(0, at - Math.floor(width / 3));
  return `${start > 0 ? "…" : ""}${flat.slice(start, start + width)}${start + width < flat.length ? "…" : ""}`;
}

export function searchDocs(docs: Doc[], query: string, limit = 40): Hit[] {
  const terms = words(query);
  if (!terms.length) return [];
  const hits: Hit[] = [];
  for (const doc of docs) {
    const title = doc.title.toLowerCase();
    const body = doc.text.toLowerCase();
    let score = 0;
    let ok = true;
    for (const t of terms) {
      const inTitle = title.includes(t);
      const inBody = body.includes(t);
      if (!inTitle && !inBody) { ok = false; break; }
      score += (inTitle ? 3 : 0) + (inBody ? 1 : 0);
    }
    if (!ok) continue;
    const first = terms.find((t) => body.includes(t)) ?? terms[0] ?? "";
    hits.push({ doc, snippet: snippetAround(doc.text || doc.title, first), score });
  }
  return hits.sort((a, b) => b.score - a.score || b.doc.at - a.doc.at).slice(0, limit);
}

/** Flatten chat messages to plain text for searching. */
export function messageText(parts: { type: string; text?: string }[] | undefined): string {
  return (parts ?? []).flatMap((p) => (p.type === "text" && p.text ? [p.text] : [])).join(" ");
}

import { tokenize } from "./rag";
import type { Entry, Workbench } from "./workbench";

/**
 * Picks which remembered facts go into a prompt, and says why. Extends the existing Workbench memories (shared, per pal, per project);
 * nothing here stores anything. Pure and deterministic: the same memories and question always give the same answer.
 *
 * If everything fits the budget, everything is sent, exactly as before. Ranking only matters when there is more than fits.
 */
export type MemoryScope = "shared" | "pal" | "project";
export type Scored = { entry: Entry; scope: MemoryScope; owner: string; score: number; reasons: string[] };
export type Pick = { used: Scored[]; left: Scored[]; text: string; ranked: boolean };

const stem = (w: string): string => (w.length > 5 && /(ing|ed)$/.test(w) ? w.replace(/(ing|ed)$/, "") : w.length > 4 && w.endsWith("es") ? w.slice(0, -2) : w.length > 3 && w.endsWith("s") ? w.slice(0, -1) : w);
const stems = (s: string): Map<string, string> => { const m = new Map<string, string>(); for (const t of tokenize(s)) { const k = stem(t); if (!m.has(k)) m.set(k, t); } return m; };

/** 0..1 word overlap, to find the same fact said twice. */
export function overlap(a: string, b: string): number {
  const A = new Set(stems(a).keys()), B = new Set(stems(b).keys());
  if (!A.size || !B.size) return 0;
  let both = 0;
  for (const w of A) if (B.has(w)) both++;
  return both / (A.size + B.size - both);
}
export const nearDuplicate = (list: Entry[], text: string, limit = 0.8): Entry | undefined => list.find((e) => overlap(e.text, text) >= limit);

const DAY = 86_400_000;

/** Everything this pal may see right now: shared, its own private ones, and the active project's. Other pals' private memories never appear. */
export function visibleMemories(w: Workbench, o: { pal?: string | undefined; project?: string | undefined; access?: "all" | "own" | "none" | undefined }): { entry: Entry; scope: MemoryScope; owner: string }[] {
  // A pal set to "none" sees no memories; "own" sees only what was told to it (and the active project's), not the shared list.
  if (o.access === "none") return [];
  return [
    ...(o.access === "own" ? [] : w.memories).map((entry) => ({ entry, scope: "shared" as const, owner: "" })),
    ...(o.pal ? (w.pal?.[o.pal] ?? []).map((entry) => ({ entry, scope: "pal" as const, owner: o.pal! })) : []),
    ...(o.project ? (w.project?.[o.project] ?? []).map((entry) => ({ entry, scope: "project" as const, owner: o.project! })) : []),
  ];
}

/** Score every visible memory for a question. `boost` is an optional 0..1 "same meaning" score per memory id (from embeddings). */
export function rankMemories(w: Workbench, query: string, o: { pal?: string | undefined; project?: string | undefined; access?: "all" | "own" | "none" | undefined; now?: number; boost?: ReadonlyMap<string, number> | undefined }): Scored[] {
  const now = o.now ?? Date.now();
  const vis = visibleMemories(w, o);
  const q = stems(query);
  const docs = vis.map((v) => new Set(stems(v.entry.text).keys()));
  const df = new Map<string, number>();
  for (const d of docs) for (const k of d) df.set(k, (df.get(k) ?? 0) + 1);
  const idf = (k: string) => Math.log(1 + vis.length / (1 + (df.get(k) ?? 0)));
  const present = [...q.keys()].filter((k) => df.has(k));
  const total = present.reduce((s, k) => s + idf(k), 0);
  return vis.map((v, i) => {
    const hit = present.filter((k) => docs[i]!.has(k));
    const keyword = total ? hit.reduce((s, k) => s + idf(k), 0) / total : 0;
    const meaning = o.boost?.get(v.entry.id) ?? 0;
    const age = Math.max(0, now - v.entry.at) / DAY;
    const recency = 0.15 * Math.pow(0.5, age / 90);
    const scope = v.scope === "project" ? 0.25 : v.scope === "pal" ? 0.1 : 0;
    const reasons: string[] = [];
    if (v.entry.pinned) reasons.push("pinned");
    if (hit.length) reasons.push(`matches: ${hit.slice(0, 4).map((k) => q.get(k) ?? k).join(", ")}`);
    if (meaning > 0.05) reasons.push("related to your question");
    if (v.scope === "pal") reasons.push("private to this pal");
    if (v.scope === "project") reasons.push(`project ${v.owner}`);
    if (!hit.length && meaning <= 0.05 && !v.entry.pinned) reasons.push("recent");
    return { ...v, score: (v.entry.pinned ? 10 : 0) + keyword + 0.6 * meaning + recency + scope, reasons };
  });
}

const line = (e: Entry) => `- ${e.text}`;
/** Builds the memory text for a prompt within `maxChars`, choosing by relevance only when everything does not fit. */
export function pickMemories(w: Workbench, query: string, o: { pal?: string | undefined; project?: string | undefined; access?: "all" | "own" | "none" | undefined; maxChars?: number; now?: number; boost?: ReadonlyMap<string, number> | undefined }): Pick {
  const maxChars = o.maxChars ?? 1500;
  const all = rankMemories(w, query, o);
  const full = all.reduce((n, s) => n + line(s.entry).length + 1, 0);
  let used: Scored[];
  let ranked = false;
  if (full <= maxChars) used = all;
  else {
    ranked = true;
    used = [];
    let n = 0;
    for (const s of [...all].sort((a, b) => b.score - a.score || b.entry.at - a.entry.at)) {
      const cost = line(s.entry).length + 1;
      if (n + cost <= maxChars) { used.push(s); n += cost; }
    }
    used.sort((a, b) => all.indexOf(a) - all.indexOf(b)); // keep the stored order inside the prompt
  }
  const left = all.filter((s) => !used.includes(s));
  const section = (scope: MemoryScope, head: string) => { const l = used.filter((s) => s.scope === scope); return l.length ? `${head}\n${l.map((s) => line(s.entry)).join("\n")}` : ""; };
  const project = o.project ? section("project", `Remembered for the project "${o.project}":`) : "";
  const text = [section("shared", "Remembered about the human:"), section("pal", "Remembered just for you (the other pals don't know this):"), project].filter(Boolean).join("\n\n");
  return { used, left, text, ranked };
}

/** Plain-words explanation, for "why did the pals know/not know this?". */
export function explainPick(p: Pick): string[] {
  const out = p.used.map((s) => `Used: “${s.entry.text.slice(0, 80)}” (${s.reasons.join("; ")})`);
  if (p.left.length) out.push(`${p.left.length} other ${p.left.length === 1 ? "memory was" : "memories were"} left out to keep the prompt short.`);
  if (!p.ranked && p.used.length) out.push("Everything fit, so nothing was filtered.");
  return out;
}

/** Folds near-duplicate memories into the newer one. Returns how many were merged. Pinned entries are never merged away. */
export function consolidate(list: Entry[], limit = 0.7): { list: Entry[]; merged: number } {
  const kept: Entry[] = [];
  let merged = 0;
  for (const e of [...list].sort((a, b) => b.at - a.at)) {
    const twin = kept.find((k) => overlap(k.text, e.text) >= limit && !(e.pinned && !k.pinned));
    if (twin && !e.pinned) { merged++; continue; }
    kept.push(e);
  }
  const keep = new Set(kept.map((k) => k.id));
  return { list: list.filter((e) => keep.has(e.id)), merged };
}

/** Folds the oldest unpinned memories into one clearly labelled digest line (no AI: just their opening words). Nothing is invented. */
export function condenseOld(list: Entry[], keep = 60, now = Date.now()): { list: Entry[]; folded: number } {
  const old = list.filter((e) => !e.pinned);
  if (list.length <= keep || old.length < 4) return { list, folded: 0 };
  const fold = old.slice(0, Math.min(old.length - 1, list.length - keep + 1));
  const ids = new Set(fold.map((e) => e.id));
  const parts: string[] = [];
  let used = 0;
  for (const e of fold) { const p = e.text.slice(0, 45).trim(); if (used + p.length + 3 > 330) break; parts.push(p); used += p.length + 3; }
  const digest: Entry = { id: `digest-${now}`, text: `Older (${fold.length}): ${parts.join(" · ")}${parts.length < fold.length ? " …" : ""}`.slice(0, 400), at: Math.min(...fold.map((e) => e.at)), digest: true };
  return { list: [digest, ...list.filter((e) => !ids.has(e.id))], folded: fold.length };
}

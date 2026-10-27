import { trimStart } from "./context-trim";

/** Token-aware, model-aware prompt budgeting with a free (no model call) digest of the turns that no longer fit. Pure. */
export type Turn = { role: string; text: string; speaker?: string };

const CJK = /[⺀-鿿가-힯]/g;
/** Rough token count: about 4 characters per token for English text and code, about 1.5 for CJK. Good enough to budget, not to bill. */
export function estimateTextTokens(text: string): number {
  const cjk = (text.match(CJK) ?? []).length;
  return Math.max(1, Math.ceil((text.length - cjk) / 4 + cjk / 1.5));
}
export const tokensToChars = (tokens: number): number => Math.floor(tokens * 3.8);

/** Usable context per engine (tokens). Ollama's OpenAI-compatible endpoint answers with a 4,096-token window unless the server was set up otherwise;
 *  the free cloud tiers have small per-minute token limits, so they are kept modest on purpose. */
const WINDOW: Record<string, number> = { "ollama-server": 4096, local: 4096, ollama: 4096, groq: 8000, openrouter: 8000, nvidia: 8000, gemini: 32000, anthropic: 100000, custom: 8000 };
export const windowTokens = (kind: unknown): number => (typeof kind === "string" ? WINDOW[kind] : undefined) ?? 8000;

/** How many characters of transcript fit: half the window (the rest is the persona, memory, documents and the reply). */
export function transcriptBudgetChars(kind: unknown, requestedChars: number): number {
  return Math.max(2000, Math.min(requestedChars, tokensToChars(Math.floor(windowTokens(kind) * 0.55))));
}

/** A retry or reconnect can leave the same turn twice in a row; keep one. */
export function dedupeTurns<T extends Turn>(items: T[]): T[] {
  const out: T[] = [];
  for (const t of items) {
    const prev = out[out.length - 1];
    if (prev && prev.role === t.role && prev.speaker === t.speaker && prev.text.trim() === t.text.trim()) continue;
    out.push(t);
  }
  return out;
}

const DECISION = /\b(decid|agree|let'?s|we'?ll|we will|plan is|going with|settled|chose|choose|use [a-z]|todo|to-do|must|never|always|deadline|due|password|port|ip|address|version|budget|\$\d)/i;
const sentences = (s: string): string[] => s.replace(/\s+/g, " ").trim().split(/(?<=[.!?])\s+/).filter(Boolean);

/** One compact line per important older turn: human turns and turns that state a decision, number or plan come first. */
export function digestTurns(turns: Turn[], maxChars: number): string {
  if (maxChars < 80) return "";
  const scored = turns.map((t, i) => {
    const ss = sentences(t.text);
    const key = ss.find((x) => DECISION.test(x)) ?? ss[0] ?? "";
    return { i, line: `${t.speaker ?? (t.role === "user" ? "Human" : "Pal")}: ${key.slice(0, 160)}`, score: (t.role === "user" ? 2 : 0) + (ss.some((x) => DECISION.test(x)) ? 3 : 0) + (key.includes("?") ? 1 : 0) - i * 0.001, key };
  }).filter((x) => x.key.length > 8);
  const picked: typeof scored = [];
  let used = 0;
  for (const x of [...scored].sort((a, b) => b.score - a.score)) {
    if (used + x.line.length + 3 > maxChars) continue;
    picked.push(x); used += x.line.length + 3;
  }
  return picked.sort((a, b) => a.i - b.i).map((x) => `- ${x.line}`).join("\n");
}

export type Built<T extends Turn> = { kept: T[]; dropped: number; digest: string };

/** Newest turns that fit ~80% of the budget (the latest turn is always kept); the older ones become a short digest in the other ~20%. */
export function buildContext<T extends Turn>(items: T[], budgetChars: number): Built<T> {
  const clean = dedupeTurns(items);
  const start = trimStart(clean, Math.floor(budgetChars * 0.8));
  const droppedTurns = clean.slice(0, start);
  return { kept: clean.slice(start), dropped: droppedTurns.length, digest: digestTurns(droppedTurns, Math.floor(budgetChars * 0.2)) };
}

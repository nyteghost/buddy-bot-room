/** Blind model-vs-model testing, inspired by Odysseus "Compare". Pure logic; the dialog drives it. */
export type ContestantKind = "groq" | "gemini" | "openrouter" | "nvidia" | "ollama" | "webgpu";
export type Contestant = { id: string; label: string; kind: ContestantKind; model?: string };
export type Scores = Record<string, { wins: number; games: number }>;

export const MIN_CONTESTANTS = 2;
export const MAX_CONTESTANTS = 3;
export const BLIND_LABELS = ["A", "B", "C"];
export const NEUTRAL_SYSTEM =
  "You are a helpful assistant in a blind comparison. Answer the question directly and clearly in under 200 words. Do not mention which model you are.";

const cloudLabels: Record<string, string> = { groq: "Groq", gemini: "Gemini", openrouter: "OpenRouter", nvidia: "NVIDIA NIM" };
export const isLocal = (c: Contestant) => c.kind === "ollama" || c.kind === "webgpu";

/** Everything you could put in the ring right now. */
export function buildContestants(opts: {
  providers: ("groq" | "gemini" | "openrouter" | "nvidia")[];
  ollamaModels: string[];
  webgpu: boolean;
}): Contestant[] {
  const list: Contestant[] = opts.providers.map((kind) => ({ id: kind, label: cloudLabels[kind] ?? kind, kind }));
  for (const model of [...new Set(opts.ollamaModels)]) list.push({ id: `ollama:${model}`, label: `Ollama ${model}`, kind: "ollama", model });
  if (opts.webgpu) list.push({ id: "webgpu", label: "In-browser (WebGPU)", kind: "webgpu" });
  return list;
}

/** Fisher–Yates; `rand` is injectable so tests are deterministic. */
export function shuffled<T>(items: readonly T[], rand: () => number = Math.random): T[] {
  const out = [...items];
  for (let i = out.length - 1; i > 0; i--) {
    const j = Math.floor(rand() * (i + 1));
    const a = out[i] as T;
    out[i] = out[j] as T;
    out[j] = a;
  }
  return out;
}

/** winnerId null = tie. Every entrant gets a game; only the winner gets a win. */
export function recordVote(scores: Scores, winnerId: string | null, entrantIds: string[]): Scores {
  const next: Scores = { ...scores };
  for (const id of entrantIds) {
    const prev = next[id] ?? { wins: 0, games: 0 };
    next[id] = { wins: prev.wins + (id === winnerId ? 1 : 0), games: prev.games + 1 };
  }
  return next;
}

export function leaderboard(scores: Scores): { id: string; wins: number; games: number; rate: number }[] {
  return Object.entries(scores)
    .map(([id, s]) => ({ id, ...s, rate: s.games ? s.wins / s.games : 0 }))
    .sort((a, b) => b.rate - a.rate || b.games - a.games || a.id.localeCompare(b.id));
}

const key = "pixel-pals-compare-v1";
export function loadScores(): Scores {
  try {
    const parsed = JSON.parse(localStorage.getItem(key) ?? "null");
    return parsed && typeof parsed === "object" ? (parsed as Scores) : {};
  } catch {
    return {};
  }
}
export function saveScores(scores: Scores) {
  try {
    localStorage.setItem(key, JSON.stringify(scores));
  } catch {
    /* optional */
  }
}

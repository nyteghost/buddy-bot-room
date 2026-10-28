/**
 * Benchmarking for the Ollama models you have installed. Only numbers Ollama (or our own stopwatch) actually reported are stored;
 * anything that cannot be measured stays `null` and is shown as "not measured". Nothing here estimates or fills in gaps.
 *
 * What is measured, per prompt:
 *  - ttftMs        wall-clock time from sending the request until the first generated text arrived (our stopwatch, streaming)
 *  - genTps        generated tokens per second (Ollama's eval_count / eval_duration)
 *  - promptTps     prompt tokens per second, and promptMs the time spent reading the prompt (Ollama's prompt_eval_*)
 *  - loadSec       time Ollama spent loading the model for this request (load_duration; ~0 when it was already loaded)
 *  - totalSec      wall-clock time of the whole request
 *  - waitMs        wall-clock time NOT spent inside Ollama (queueing behind another request, network). Derived: wall - total_duration
 *  - vramGb/gpuPct the model's memory on the GPU right after the run (/api/ps size_vram), and its share of the model
 * The reasoning and code prompts also get a simple automatic check (did the answer contain the expected result); chat has none.
 * That check is a smoke test, not a quality score.
 */
export const BENCH_VERSION = 1;
export type BenchTask = "chat" | "code" | "reasoning";
export type BenchPrompt = { task: BenchTask; prompt: string; maxTokens: number; check?: (text: string) => boolean };

/** Fixed prompts, temperature 0 and a fixed seed, so a rerun on the same setup is comparable. */
export const BENCH_SET: BenchPrompt[] = [
  { task: "chat", prompt: "Explain in about three sentences why the sky looks blue during the day but red at sunset.", maxTokens: 140 },
  {
    task: "code",
    prompt: "Write a Python function is_palindrome(s) that ignores case and anything that is not a letter or digit, then show two short example calls.",
    maxTokens: 260,
    check: (t) => /def\s+is_palindrome\s*\(/.test(t),
  },
  {
    task: "reasoning",
    prompt: "A train leaves at 3:15 pm and the trip takes 2 hours 50 minutes. A bus leaves 25 minutes after the train arrives. Give the bus departure time first, then one line of working.",
    maxTokens: 200,
    check: (t) => /\b6[:.]\s?30\b/.test(t),
  },
];
export const BENCH_OPTIONS = { temperature: 0, seed: 42 } as const;

/** The last chunk Ollama sends for /api/generate. All durations are nanoseconds. */
export type GenerateFinal = {
  total_duration?: number;
  load_duration?: number;
  prompt_eval_count?: number;
  prompt_eval_duration?: number;
  eval_count?: number;
  eval_duration?: number;
};
export type PsEntry = { name?: string; size?: number; size_vram?: number };

export type BenchResult = {
  v: number;
  id: string;
  at: number;
  model: string;
  task: BenchTask;
  ok: boolean;
  error?: string;
  ttftMs: number | null;
  genTps: number | null;
  promptTps: number | null;
  promptMs: number | null;
  loadSec: number | null;
  totalSec: number;
  waitMs: number | null;
  outTokens: number | null;
  vramGb: number | null;
  gpuPct: number | null;
  passed?: boolean;
};

const pos = (n: unknown): n is number => typeof n === "number" && Number.isFinite(n) && n > 0;
const round = (n: number, d = 1) => Math.round(n * 10 ** d) / 10 ** d;

/** Turns one finished (or failed) request into a stored record. */
export function measure(o: {
  model: string;
  task: BenchTask;
  startedAt: number;
  firstTokenAt: number | null;
  endedAt: number;
  final: GenerateFinal | null;
  text: string;
  ps: PsEntry | null;
  error?: string;
  id?: string;
  check?: ((text: string) => boolean) | undefined;
}): BenchResult {
  const wall = Math.max(0, o.endedAt - o.startedAt);
  const f = o.final;
  const ok = !o.error && !!f && pos(f.eval_count);
  const base = { v: BENCH_VERSION, id: o.id ?? `${o.endedAt.toString(36)}${Math.random().toString(36).slice(2, 6)}`, at: o.endedAt, model: o.model, task: o.task, totalSec: round(wall / 1000, 2) };
  if (!ok || !f) return { ...base, ok: false, error: (o.error ?? "Ollama returned no timing information.").slice(0, 200), ttftMs: null, genTps: null, promptTps: null, promptMs: null, loadSec: null, waitMs: null, outTokens: null, vramGb: null, gpuPct: null };
  const ps = o.ps;
  return {
    ...base,
    ok: true,
    ttftMs: o.firstTokenAt === null ? null : Math.max(0, Math.round(o.firstTokenAt - o.startedAt)),
    genTps: pos(f.eval_count) && pos(f.eval_duration) ? round(f.eval_count / (f.eval_duration / 1e9)) : null,
    promptTps: pos(f.prompt_eval_count) && pos(f.prompt_eval_duration) ? round(f.prompt_eval_count / (f.prompt_eval_duration / 1e9)) : null,
    promptMs: pos(f.prompt_eval_duration) ? Math.round(f.prompt_eval_duration / 1e6) : null,
    loadSec: typeof f.load_duration === "number" && f.load_duration >= 0 ? round(f.load_duration / 1e9, 2) : null,
    waitMs: pos(f.total_duration) ? Math.max(0, Math.round(wall - f.total_duration / 1e6)) : null,
    outTokens: f.eval_count ?? null,
    vramGb: ps && typeof ps.size_vram === "number" ? round(ps.size_vram / 1024 ** 3) : null,
    gpuPct: ps && pos(ps.size) && typeof ps.size_vram === "number" ? Math.min(100, Math.round((ps.size_vram / ps.size) * 100)) : null,
    ...(o.check ? { passed: o.check(o.text) } : {}),
  };
}

// ── summaries and recommendations ──
export const median = (xs: number[]): number | null => {
  if (!xs.length) return null;
  const s = [...xs].sort((a, b) => a - b);
  const m = s.length >> 1;
  return round(s.length % 2 ? s[m]! : (s[m - 1]! + s[m]!) / 2);
};
const DAY = 86_400_000;
export const MAX_AGE_DAYS = 90;
const usable = (r: BenchResult, now: number) => r.v === BENCH_VERSION && now - r.at <= MAX_AGE_DAYS * DAY;

export type ModelSummary = {
  model: string;
  runs: number;
  failures: number;
  failureRate: number;
  genTps: number | null;
  ttftMs: number | null;
  promptTps: number | null;
  loadSec: number | null;
  vramGb: number | null;
  gpuPct: number | null;
  checked: number;
  passed: number;
  lastAt: number;
  byTask: Partial<Record<BenchTask, { genTps: number | null; passed: boolean | null }>>;
};

export function summarize(results: BenchResult[], now = Date.now()): ModelSummary[] {
  const by = new Map<string, BenchResult[]>();
  for (const r of results) if (usable(r, now)) by.set(r.model, [...(by.get(r.model) ?? []), r]);
  return [...by].map(([model, rs]) => {
    const good = rs.filter((r) => r.ok);
    const nums = (pick: (r: BenchResult) => number | null) => good.map(pick).filter((n): n is number => n !== null);
    const checked = good.filter((r) => r.passed !== undefined);
    const latest = [...good].sort((a, b) => b.at - a.at)[0];
    const byTask: ModelSummary["byTask"] = {};
    for (const t of ["chat", "code", "reasoning"] as const) {
      const mine = good.filter((r) => r.task === t);
      if (mine.length) byTask[t] = { genTps: median(mine.map((r) => r.genTps).filter((n): n is number => n !== null)), passed: mine.some((r) => r.passed !== undefined) ? mine.every((r) => r.passed !== false) : null };
    }
    return {
      model,
      runs: rs.length,
      failures: rs.length - good.length,
      failureRate: round((rs.length - good.length) / rs.length, 2),
      genTps: median(nums((r) => r.genTps)),
      ttftMs: median(nums((r) => r.ttftMs)),
      promptTps: median(nums((r) => r.promptTps)),
      loadSec: latest?.loadSec ?? null,
      vramGb: latest?.vramGb ?? null,
      gpuPct: latest?.gpuPct ?? null,
      checked: checked.length,
      passed: checked.filter((r) => r.passed).length,
      lastAt: Math.max(...rs.map((r) => r.at)),
      byTask,
    };
  }).sort((a, b) => (b.genTps ?? -1) - (a.genTps ?? -1));
}

/** Below this a conversation is painful, so a measured model this slow is avoided when another choice exists. */
export const TOO_SLOW_TPS = 5;
/** Models whose own measurements say "don't pick me automatically": mostly failing, or measured too slow. Needs at least 3 runs to count. */
export function avoidModels(summary: ModelSummary[]): Set<string> {
  const out = new Set<string>();
  for (const s of summary) if (s.runs >= 3 && (s.failureRate >= 0.5 || (s.genTps !== null && s.genTps < TOO_SLOW_TPS))) out.add(s.model);
  return out;
}

export type MeasuredPick = { task: BenchTask; model: string; genTps: number; passed: boolean | null };
/** The best measured model per kind of job: it must have worked, and among those the one that passed the check and generates fastest. */
export function measuredBest(summary: ModelSummary[]): MeasuredPick[] {
  const picks: MeasuredPick[] = [];
  for (const task of ["chat", "code", "reasoning"] as const) {
    const cands = summary.flatMap((s) => {
      const t = s.byTask[task];
      return t && t.genTps !== null && s.failureRate < 0.5 ? [{ model: s.model, genTps: t.genTps, passed: t.passed }] : [];
    });
    cands.sort((a, b) => Number(b.passed !== false) - Number(a.passed !== false) || b.genTps - a.genTps);
    const top = cands[0];
    if (top) picks.push({ task, ...top });
  }
  return picks;
}

/** Keeps stored results bounded: newest first, a cap per model and overall. */
export function trimResults(rs: BenchResult[], perModel = 60, total = 400): BenchResult[] {
  const seen = new Map<string, number>();
  return [...rs].sort((a, b) => b.at - a.at).filter((r) => {
    const n = (seen.get(r.model) ?? 0) + 1;
    seen.set(r.model, n);
    return n <= perModel;
  }).slice(0, total);
}

/** Reads stored JSON defensively (the file lives in your data folder and could be edited or damaged). */
export function cleanResults(v: unknown): BenchResult[] {
  if (!Array.isArray(v)) return [];
  const out: BenchResult[] = [];
  for (const r of v) {
    if (!r || typeof r !== "object") continue;
    const o = r as Record<string, unknown>;
    if (o["v"] !== BENCH_VERSION || typeof o["model"] !== "string" || !["chat", "code", "reasoning"].includes(String(o["task"])) || typeof o["at"] !== "number" || typeof o["ok"] !== "boolean") continue;
    const n = (x: unknown): number | null => (typeof x === "number" && Number.isFinite(x) ? x : null);
    out.push({
      v: BENCH_VERSION, id: typeof o["id"] === "string" ? o["id"].slice(0, 40) : String(o["at"]), at: o["at"], model: o["model"].slice(0, 120), task: o["task"] as BenchTask, ok: o["ok"],
      ...(typeof o["error"] === "string" ? { error: o["error"].slice(0, 200) } : {}),
      ttftMs: n(o["ttftMs"]), genTps: n(o["genTps"]), promptTps: n(o["promptTps"]), promptMs: n(o["promptMs"]), loadSec: n(o["loadSec"]), totalSec: n(o["totalSec"]) ?? 0,
      waitMs: n(o["waitMs"]), outTokens: n(o["outTokens"]), vramGb: n(o["vramGb"]), gpuPct: n(o["gpuPct"]),
      ...(typeof o["passed"] === "boolean" ? { passed: o["passed"] } : {}),
    });
  }
  return out;
}

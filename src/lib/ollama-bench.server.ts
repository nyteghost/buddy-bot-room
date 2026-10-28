import { BENCH_OPTIONS, BENCH_SET, avoidModels, cleanResults, measure, summarize, trimResults, type BenchPrompt, type BenchResult, type GenerateFinal, type PsEntry } from "./ollama-bench";

/** One streamed chunk from Ollama's /api/generate. */
export type GenChunk = GenerateFinal & { response?: string; done?: boolean; error?: string };
/** The network part, injected so the suite logic is tested without an Ollama. */
export type BenchApi = {
  generate: (model: string, prompt: string, o: { maxTokens: number; keepAlive: string | null }) => AsyncIterable<GenChunk>;
  ps: () => Promise<PsEntry[]>;
  now: () => number;
};

/** One timed request. Never throws: a failure becomes a stored failed result, because failures are part of the measurement. */
export async function benchOne(api: BenchApi, model: string, bp: BenchPrompt, keepAlive: string | null): Promise<BenchResult> {
  const startedAt = api.now();
  let firstTokenAt: number | null = null;
  let final: GenChunk | null = null;
  let text = "";
  let error: string | undefined;
  try {
    for await (const chunk of api.generate(model, bp.prompt, { maxTokens: bp.maxTokens, keepAlive })) {
      if (chunk.error) { error = chunk.error; break; }
      if (chunk.response) { if (firstTokenAt === null) firstTokenAt = api.now(); text += chunk.response; }
      if (chunk.done) final = chunk;
    }
  } catch (e) {
    error = e instanceof Error ? e.message : "request failed";
  }
  const endedAt = api.now();
  const ps = error ? null : await api.ps().then((list) => list.find((m) => m.name === model || m.name === `${model}:latest` || `${m.name}:latest` === model) ?? null).catch(() => null);
  return measure({ model, task: bp.task, startedAt, firstTokenAt, endedAt, final, text, ps, check: bp.check, ...(error ? { error } : {}) });
}

export type SuiteEvent =
  | { type: "step"; label: string }
  | { type: "result"; result: BenchResult }
  | { type: "done" };

/** Loads the model once (so the three prompts run warm and load time is reported separately), then runs the fixed prompt set. */
export async function* runSuite(api: BenchApi, model: string, keepAlive: string | null, set: BenchPrompt[] = BENCH_SET): AsyncGenerator<SuiteEvent> {
  yield { type: "step", label: `Loading ${model}…` };
  const warm = await benchOne(api, model, { task: "chat", prompt: "Say hi.", maxTokens: 1 }, keepAlive);
  if (!warm.ok) {
    // The model did not even start: that is one failure per prompt, recorded honestly.
    for (const bp of set) yield { type: "result", result: { ...warm, id: `${warm.id}-${bp.task}`, task: bp.task } };
    yield { type: "done" };
    return;
  }
  for (const bp of set) {
    yield { type: "step", label: `${model}: ${bp.task} prompt…` };
    const r = await benchOne(api, model, bp, keepAlive);
    // The prompts run on a loaded model, so the load time that matters is the warm-up's.
    yield { type: "result", result: r.ok ? { ...r, loadSec: warm.loadSec } : r };
  }
  yield { type: "done" };
}

/** The real Ollama. */
export function httpBenchApi(base: string): BenchApi {
  return {
    now: () => performance.now() + performance.timeOrigin,
    async ps() {
      const res = await fetch(`${base}/api/ps`, { signal: AbortSignal.timeout(5000) });
      return res.ok ? (((await res.json()) as { models?: PsEntry[] }).models ?? []) : [];
    },
    async *generate(model, prompt, o) {
      const res = await fetch(`${base}/api/generate`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ model, prompt, stream: true, ...(o.keepAlive ? { keep_alive: /^-?\d+$/.test(o.keepAlive) ? Number(o.keepAlive) : o.keepAlive } : {}), options: { ...BENCH_OPTIONS, num_predict: o.maxTokens } }),
        signal: AbortSignal.timeout(180_000),
      });
      if (!res.ok || !res.body) throw new Error(`Ollama answered ${res.status}${res.status === 404 ? " (is the model downloaded?)" : ""}`);
      const reader = res.body.getReader();
      const dec = new TextDecoder();
      let buf = "";
      for (;;) {
        const { done, value } = await reader.read();
        if (done) break;
        buf += dec.decode(value, { stream: true });
        const lines = buf.split("\n");
        buf = lines.pop() ?? "";
        for (const line of lines) if (line.trim()) { try { yield JSON.parse(line) as GenChunk; } catch { /* partial line */ } }
      }
      if (buf.trim()) { try { yield JSON.parse(buf) as GenChunk; } catch { /* ignore */ } }
    },
  };
}

// ── storage: BUDDY_DATA_DIR/ollama-bench.json (kept in memory only when there is no data folder) ──
const holder = globalThis as unknown as { __ppBench?: BenchResult[]; __ppBenchBusy?: boolean };
const file = () => {
  const dir = (process.env["BUDDY_DATA_DIR"] ?? "").trim().replace(/\/+$/, "");
  return dir ? `${dir}/ollama-bench.json` : "";
};
const fsp = () => import(/* @vite-ignore */ "node:" + "fs/promises");
export const benchPersistent = (): boolean => !!file();

export async function readResults(): Promise<BenchResult[]> {
  if (holder.__ppBench) return holder.__ppBench;
  let rs: BenchResult[] = [];
  const path = file();
  if (path) { try { rs = cleanResults(JSON.parse(await (await fsp()).readFile(path, "utf8"))); } catch { /* none yet, or damaged: start empty (the file is left alone until the next write) */ } }
  return (holder.__ppBench = rs);
}
async function save(rs: BenchResult[]): Promise<void> {
  holder.__ppBench = rs;
  const path = file();
  if (!path) return;
  const f = await fsp();
  const tmp = `${path}.${process.pid}.tmp`;
  await f.writeFile(tmp, JSON.stringify(rs), { mode: 0o600 });
  await f.rename(tmp, path);
}
export async function addResult(r: BenchResult): Promise<void> { await save(trimResults([r, ...(await readResults())])); }
export async function clearResults(model?: string): Promise<void> { await save(model ? (await readResults()).filter((r) => r.model !== model) : []); }

/** Models the user's own measurements say to avoid when choosing automatically. Empty on any problem. */
export async function avoidedModels(): Promise<Set<string>> {
  try { return avoidModels(summarize(await readResults())); } catch { return new Set(); }
}
/** Only one benchmark at a time: two at once would measure each other. */
export function takeBenchLock(): (() => void) | null {
  if (holder.__ppBenchBusy) return null;
  holder.__ppBenchBusy = true;
  return () => { holder.__ppBenchBusy = false; };
}

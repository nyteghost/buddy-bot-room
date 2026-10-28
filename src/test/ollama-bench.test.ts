import { describe, expect, it } from "vitest";
import { BENCH_SET, BENCH_VERSION, avoidModels, cleanResults, measure, measuredBest, median, summarize, trimResults, type BenchResult } from "../lib/ollama-bench";
import { runSuite, type BenchApi, type GenChunk } from "../lib/ollama-bench.server";
import { bestInstalled } from "../lib/model-catalog";

const final = { total_duration: 4e9, load_duration: 1e9, prompt_eval_count: 20, prompt_eval_duration: 2e8, eval_count: 100, eval_duration: 2e9 };
const mk = (o: Partial<BenchResult> & { model: string }): BenchResult => ({ v: BENCH_VERSION, id: Math.random().toString(36), at: Date.now(), task: "chat", ok: true, ttftMs: 300, genTps: 40, promptTps: 100, promptMs: 200, loadSec: 1, totalSec: 4, waitMs: 0, outTokens: 100, vramGb: 5, gpuPct: 100, ...o });

describe("measure", () => {
  it("computes only from what Ollama and the stopwatch reported", () => {
    const r = measure({ model: "m", task: "chat", startedAt: 1000, firstTokenAt: 1400, endedAt: 6000, final, text: "x", ps: { size: 8 * 1024 ** 3, size_vram: 6 * 1024 ** 3 } });
    expect(r).toMatchObject({ ok: true, ttftMs: 400, genTps: 50, promptTps: 100, promptMs: 200, loadSec: 1, totalSec: 5, waitMs: 1000, outTokens: 100, vramGb: 6, gpuPct: 75 });
  });
  it("leaves unknowns as null instead of guessing", () => {
    const r = measure({ model: "m", task: "chat", startedAt: 0, firstTokenAt: null, endedAt: 3000, final: { eval_count: 10, eval_duration: 1e9 }, text: "", ps: null });
    expect(r).toMatchObject({ ok: true, ttftMs: null, genTps: 10, promptTps: null, promptMs: null, waitMs: null, vramGb: null, gpuPct: null });
  });
  it("records a failure with its message and no numbers", () => {
    const r = measure({ model: "m", task: "code", startedAt: 0, firstTokenAt: null, endedAt: 500, final: null, text: "", ps: null, error: "out of memory" });
    expect(r).toMatchObject({ ok: false, error: "out of memory", genTps: null, ttftMs: null });
    expect(measure({ model: "m", task: "chat", startedAt: 0, firstTokenAt: 1, endedAt: 2, final: {}, text: "", ps: null }).ok).toBe(false);
  });
  it("runs the simple check when a prompt has one", () => {
    const code = BENCH_SET.find((b) => b.task === "code")!;
    const reasoning = BENCH_SET.find((b) => b.task === "reasoning")!;
    expect(code.check!("def is_palindrome(s):\n  return True")).toBe(true);
    expect(code.check!("I cannot")).toBe(false);
    expect(reasoning.check!("The bus leaves at 6:30 pm.")).toBe(true);
    expect(reasoning.check!("It leaves at 7:00.")).toBe(false);
  });
});

describe("summaries and recommendations", () => {
  it("medians, failure rate and per-task numbers", () => {
    expect(median([3, 1, 2])).toBe(2);
    expect(median([])).toBeNull();
    const rs = [mk({ model: "a", genTps: 30 }), mk({ model: "a", genTps: 50 }), mk({ model: "a", ok: false, genTps: null, error: "x" })];
    const [s] = summarize(rs);
    expect(s).toMatchObject({ model: "a", runs: 3, failures: 1, failureRate: 0.33, genTps: 40 });
  });
  it("ignores old or other-version results", () => {
    const old = mk({ model: "a", at: Date.now() - 200 * 86_400_000 });
    const other = { ...mk({ model: "b" }), v: 99 } as unknown as BenchResult;
    expect(summarize([old, other])).toEqual([]);
  });
  it("avoids models that mostly fail or are too slow, but only with 3+ runs", () => {
    const slow = [1, 2, 3].map(() => mk({ model: "slow", genTps: 3 }));
    const flaky = [mk({ model: "flaky", ok: false, genTps: null }), mk({ model: "flaky", ok: false, genTps: null }), mk({ model: "flaky" })];
    const fine = [1, 2, 3].map(() => mk({ model: "fine", genTps: 40 }));
    const few = [mk({ model: "few", genTps: 1 })];
    expect([...avoidModels(summarize([...slow, ...flaky, ...fine, ...few]))].sort()).toEqual(["flaky", "slow"]);
  });
  it("picks the measured best per task: passes the check first, then speed", () => {
    const rs = [
      mk({ model: "fast", task: "code", genTps: 90, passed: false }),
      mk({ model: "good", task: "code", genTps: 40, passed: true }),
      mk({ model: "fast", task: "chat", genTps: 90 }),
      mk({ model: "good", task: "chat", genTps: 40 }),
    ];
    const best = measuredBest(summarize(rs));
    expect(best.find((b) => b.task === "code")!.model).toBe("good");
    expect(best.find((b) => b.task === "chat")!.model).toBe("fast");
    expect(best.find((b) => b.task === "reasoning")).toBeUndefined();
  });
  it("trims per model and overall, newest kept", () => {
    const rs = Array.from({ length: 10 }, (_, i) => mk({ model: "a", at: i }));
    expect(trimResults(rs, 3).map((r) => r.at)).toEqual([9, 8, 7]);
  });
  it("reads damaged stored data safely", () => {
    expect(cleanResults("nope")).toEqual([]);
    const good = mk({ model: "a" });
    expect(cleanResults([good, { v: 1 }, null, { ...good, task: "x" }, { ...good, v: 7 }]).length).toBe(1);
  });
});

describe("automatic choice uses the measurements", () => {
  const list = [{ name: "big:30b", gb: 18 }, { name: "mid:8b", gb: 5 }];
  const hw = { cpu: "x", cores: 8, ramGb: 32, gpus: [{ name: "RTX 3080", vramGb: 10 }], gpuSource: "override" as const };
  it("skips an avoided model when another remains, never leaves nothing", () => {
    expect(bestInstalled("chat", list, hw, new Set(["mid:8b"]))).not.toBe("mid:8b");
    expect(bestInstalled("chat", [{ name: "mid:8b", gb: 5 }], hw, new Set(["mid:8b"]))).toBe("mid:8b");
    expect(bestInstalled("chat", list, hw)).toBe("mid:8b");
  });
});

describe("runSuite", () => {
  const api = (script: (model: string, prompt: string) => GenChunk[] | Error): BenchApi => {
    let t = 0;
    return {
      now: () => (t += 100),
      ps: async () => [{ name: "m", size: 4 * 1024 ** 3, size_vram: 4 * 1024 ** 3 }],
      async *generate(model, prompt) {
        const out = script(model, prompt);
        if (out instanceof Error) throw out;
        for (const c of out) yield c;
      },
    };
  };
  const ok = (text: string): GenChunk[] => [{ response: text }, { response: "", done: true, ...final }];
  it("warms up, then runs the three prompts and reports the warm-up load time", async () => {
    const events = [];
    for await (const e of runSuite(api((_m, p) => ok(p.includes("palindrome") ? "def is_palindrome(s): pass" : p.includes("train") ? "6:30" : "blue")), "m", null)) events.push(e);
    const results = events.flatMap((e) => (e.type === "result" ? [e.result] : []));
    expect(results.map((r) => r.task)).toEqual(["chat", "code", "reasoning"]);
    expect(results.every((r) => r.ok && r.loadSec === 1 && r.vramGb === 4)).toBe(true);
    expect(results.map((r) => r.passed)).toEqual([undefined, true, true]);
    expect(events.at(-1)).toEqual({ type: "done" });
  });
  it("records one failure per prompt when the model will not start", async () => {
    const events = [];
    for await (const e of runSuite(api(() => new Error("model requires more system memory")), "m", null)) events.push(e);
    const results = events.flatMap((e) => (e.type === "result" ? [e.result] : []));
    expect(results.length).toBe(3);
    expect(results.every((r) => !r.ok && /memory/.test(r.error ?? ""))).toBe(true);
    expect(new Set(results.map((r) => r.id)).size).toBe(3);
  });
});

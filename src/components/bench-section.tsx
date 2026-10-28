import { useCallback, useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import type { BenchResult, MeasuredPick, ModelSummary } from "@/lib/ollama-bench";

type Stored = { summary: ModelSummary[]; best: MeasuredPick[]; avoid: string[]; persistent: boolean };
const post = (body: unknown) => fetch("/api/ollama", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });
const num = (n: number | null, unit = "") => (n === null ? "not measured" : `${n}${unit}`);

/** Runs a small fixed benchmark (chat, code, reasoning) on an installed Ollama model and shows what was actually measured. Results are stored on the server. */
export function BenchSection({ installed }: { installed: string[] }) {
  const [data, setData] = useState<Stored | null>(null);
  const [model, setModel] = useState("");
  const [running, setRunning] = useState("");
  const [note, setNote] = useState("");
  const chosen = model || installed[0] || "";

  const load = useCallback(() => {
    post({ action: "bench-results", model: "x" }).then((r) => r.json()).then((j) => setData(j as Stored)).catch(() => undefined);
  }, []);
  useEffect(load, [load]);

  async function run() {
    if (!chosen || running) return;
    setNote("");
    setRunning("Starting…");
    try {
      const res = await post({ action: "bench-suite", model: chosen });
      if (!res.ok || !res.body) throw new Error(((await res.json().catch(() => ({}))) as { error?: string }).error ?? "The benchmark could not start.");
      const reader = res.body.getReader();
      const dec = new TextDecoder();
      let buf = "";
      let fails = 0, oks = 0;
      for (;;) {
        const { done, value } = await reader.read();
        if (done) break;
        buf += dec.decode(value, { stream: true });
        const lines = buf.split("\n");
        buf = lines.pop() ?? "";
        for (const line of lines) {
          if (!line.trim()) continue;
          const ev = JSON.parse(line) as { type: string; label?: string; message?: string; result?: BenchResult };
          if (ev.type === "step") setRunning(ev.label ?? "Testing…");
          if (ev.type === "result") (ev.result?.ok ? oks++ : fails++);
          if (ev.type === "error") throw new Error(ev.message);
        }
      }
      setNote(fails ? `${chosen}: ${oks} of ${oks + fails} prompts worked. Failures count against the model in the results.` : `${chosen}: benchmark finished.`);
    } catch (e) {
      setNote(e instanceof Error ? e.message : "The benchmark failed.");
    } finally {
      setRunning("");
      load();
    }
  }

  async function clear() {
    if (!window.confirm("Delete all stored benchmark results?")) return;
    await post({ action: "bench-clear", model: "x" });
    load();
  }

  return (
    <details className="rounded-md border px-3 py-2">
      <summary className="cursor-pointer">Benchmark <span className="text-xs text-muted-foreground">measures speed on this machine</span></summary>
      <div className="mt-2 grid gap-2 text-sm">
        <p className="text-xs text-muted-foreground">Runs the same three short prompts (chat, code, reasoning) at temperature 0 and records what Ollama reports: time to first word, tokens per second, load time, GPU memory. Takes about a minute. Don't chat with this model while it runs.</p>
        <div className="flex flex-wrap items-center gap-2">
          <select aria-label="Model to benchmark" className="h-9 rounded-md border border-input bg-background px-2" value={chosen} onChange={(e) => setModel(e.target.value)} disabled={!!running}>
            {installed.map((n) => <option key={n} value={n}>{n}</option>)}
          </select>
          <Button size="sm" className="h-11 sm:h-8" disabled={!chosen || !!running} onClick={() => void run()}>{running || "Run benchmark"}</Button>
        </div>
        {note && <p role="status" className="text-xs text-muted-foreground">{note}</p>}
        {data && data.summary.length === 0 && <p className="text-xs text-muted-foreground">No results yet.</p>}
        {data && data.summary.length > 0 && (
          <div className="grid gap-2">
            {data.summary.map((s) => (
              <div key={s.model} className="rounded-md border px-3 py-2">
                <div className="font-medium">{s.model}{data.avoid.includes(s.model) && <span className="ml-2 text-xs font-normal text-destructive">skipped by automatic choice</span>}</div>
                <div className="text-xs text-muted-foreground">
                  {num(s.genTps, " tokens/s")} · first word {num(s.ttftMs, " ms")} · prompt {num(s.promptTps, " tokens/s")} · load {num(s.loadSec, " s")} · GPU memory {num(s.vramGb, " GB")}{s.gpuPct !== null ? ` (${s.gpuPct}% of the model)` : ""}
                </div>
                <div className="text-xs text-muted-foreground">
                  {s.runs} runs, {s.failures} failed ({Math.round(s.failureRate * 100)}%){s.checked ? ` · simple answer check passed ${s.passed} of ${s.checked}` : ""} · last {new Date(s.lastAt).toLocaleDateString()}
                </div>
              </div>
            ))}
            {data.best.length > 0 && (
              <p className="text-xs text-muted-foreground">Best measured: {data.best.map((b) => `${b.task} → ${b.model} (${b.genTps} tokens/s${b.passed === false ? ", failed the check" : ""})`).join(" · ")}. Models that mostly failed or ran under 5 tokens/s (after 3+ runs) are skipped by “Automatic (by task)” when something else is installed.</p>
            )}
            {!data.persistent && <p className="text-xs text-destructive">No data folder is set (BUDDY_DATA_DIR), so these results are lost when the server restarts.</p>}
            <div><Button size="sm" variant="outline" className="h-11 sm:h-8" onClick={() => void clear()}>Delete results</Button></div>
          </div>
        )}
      </div>
    </details>
  );
}

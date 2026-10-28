/** Small in-process job runner for the background scheduler: one run per job id at a time, optional lanes (limit of
 *  simultaneous runs, e.g. 1 for model inference on a single GPU), per-run timeout, cancellation and limited retries. */
export type JobResult = "done" | "skipped" | "failed" | "timeout" | "cancelled";
export type JobState = { running: boolean; queued: boolean; startedAt?: number; endedAt?: number; lastResult?: JobResult; lastError?: string; runs: number; skipped: number; failures: number };
export type RunOptions = {
  timeoutMs: number;
  /** Jobs in the same lane wait for a free slot (laneLimit simultaneous runs, default 1). */
  lane?: string;
  laneLimit?: number;
  /** Extra attempts after a failure, with exponential backoff (backoffMs, 2x, 4x...). Timeouts and cancels are not retried. */
  retries?: number;
  backoffMs?: number;
};

type Lane = { active: number; limit: number; waiting: (() => void)[] };

export function createJobRunner(onEvent: (level: "info" | "warn", text: string) => void = () => undefined, clock: () => number = Date.now) {
  const states = new Map<string, JobState>();
  const controllers = new Map<string, AbortController>();
  const lanes = new Map<string, Lane>();
  const state = (id: string): JobState => { let s = states.get(id); if (!s) states.set(id, (s = { running: false, queued: false, runs: 0, skipped: 0, failures: 0 })); return s; };

  const acquire = async (name: string, limit: number, signal: AbortSignal): Promise<boolean> => {
    let lane = lanes.get(name);
    if (!lane) lanes.set(name, (lane = { active: 0, limit, waiting: [] }));
    lane.limit = limit;
    if (lane.active < lane.limit) { lane.active++; return true; }
    return new Promise<boolean>((ok) => {
      const grant = () => { signal.removeEventListener("abort", drop); ok(true); };
      const drop = () => { lane!.waiting = lane!.waiting.filter((w) => w !== grant); ok(false); };
      lane!.waiting.push(grant);
      signal.addEventListener("abort", drop, { once: true });
    });
  };
  const release = (name: string) => {
    const lane = lanes.get(name);
    if (!lane) return;
    const next = lane.waiting.shift();
    if (next) next(); else lane.active--;
  };
  const sleep = (ms: number, signal: AbortSignal) => new Promise<void>((ok) => { const t = setTimeout(ok, ms); signal.addEventListener("abort", () => { clearTimeout(t); ok(); }, { once: true }); });

  async function run(id: string, fn: (signal: AbortSignal) => Promise<unknown>, opts: RunOptions): Promise<JobResult> {
    const st = state(id);
    if (st.running) { st.skipped++; onEvent("warn", `Job ${id} is still running; this tick skipped it`); return "skipped"; }
    st.running = true; st.queued = !!opts.lane;
    const controller = new AbortController();
    controllers.set(id, controller);
    let timedOut = false;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const finish = (r: JobResult, error?: string): JobResult => {
      if (timer) clearTimeout(timer);
      st.running = false; st.queued = false; st.endedAt = clock(); st.lastResult = r;
      if (error) st.lastError = error; else if (r === "done") delete st.lastError;
      if (r === "failed" || r === "timeout") st.failures++;
      controllers.delete(id);
      return r;
    };
    // The clock for the timeout starts once the job actually runs, not while it waits in a lane.
    let release0: (() => void) | undefined;
    try {
      if (opts.lane) {
        if (!(await acquire(opts.lane, opts.laneLimit ?? 1, controller.signal))) return finish("cancelled");
        release0 = () => release(opts.lane!);
      }
      st.queued = false; st.startedAt = clock(); st.runs++;
      const budget = new Promise<"timeout">((ok) => { timer = setTimeout(() => { timedOut = true; controller.abort(); ok("timeout"); }, opts.timeoutMs); });
      const attempts = (opts.retries ?? 0) + 1;
      for (let attempt = 1; attempt <= attempts; attempt++) {
        try {
          const out = await Promise.race([fn(controller.signal).then(() => "ok" as const), budget]);
          if (out === "timeout" || timedOut) { onEvent("warn", `Job ${id} timed out after ${Math.round(opts.timeoutMs / 1000)}s`); return finish("timeout", "timed out"); }
          return finish("done");
        } catch (e) {
          if (controller.signal.aborted) return timedOut ? finish("timeout", "timed out") : finish("cancelled");
          const msg = e instanceof Error ? e.message : "error";
          if (attempt >= attempts) { onEvent("warn", `Job ${id} failed: ${msg}`); return finish("failed", msg); }
          await sleep((opts.backoffMs ?? 1000) * 2 ** (attempt - 1), controller.signal);
          if (controller.signal.aborted) return timedOut ? finish("timeout", "timed out") : finish("cancelled");
        }
      }
      return finish("failed", "no attempts");
    } finally { release0?.(); }
  }

  return {
    run,
    /** Cancel a running or waiting job. Returns false if it isn't running. */
    cancel(id: string): boolean { const c = controllers.get(id); if (!c) return false; c.abort(); return true; },
    state(id: string): JobState | undefined { const s = states.get(id); return s ? { ...s } : undefined; },
    snapshot(): Record<string, JobState> { return Object.fromEntries([...states].map(([k, v]) => [k, { ...v }])); },
  };
}
export type JobRunner = ReturnType<typeof createJobRunner>;

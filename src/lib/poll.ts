export type PollEnv = {
  now(): number;
  hidden(): boolean;
  setTimeout(fn: () => void, ms: number): unknown;
  clearTimeout(id: unknown): void;
  onVisible(fn: () => void): () => void;
};
export const browserEnv: PollEnv = {
  now: () => Date.now(),
  hidden: () => typeof document !== "undefined" && document.visibilityState === "hidden",
  setTimeout: (fn, ms) => window.setTimeout(fn, ms),
  clearTimeout: (id) => window.clearTimeout(id as number),
  onVisible: (fn) => {
    const h = () => { if (document.visibilityState === "visible") fn(); };
    document.addEventListener("visibilitychange", h);
    return () => document.removeEventListener("visibilitychange", h);
  },
};

/** Repeats `task` every `ms`, but: never while the tab is hidden (it catches up as soon as the tab is visible again if it is overdue),
 *  never two at once, and with doubling delays (up to maxMs) while `task` keeps failing (throws or resolves false). Returns a stop function. */
export function startPolling(task: () => Promise<boolean | void>, ms: number, opts: { maxMs?: number; immediate?: boolean; env?: PollEnv } = {}): () => void {
  const env = opts.env ?? browserEnv;
  let stopped = false, running = false, timer: unknown = null, delay = ms, lastRun = -Infinity;
  const schedule = (wait: number) => { if (stopped) return; if (timer !== null) env.clearTimeout(timer); timer = env.setTimeout(fire, wait); };
  const fire = async () => {
    timer = null;
    if (stopped) return;
    if (env.hidden()) return; // resumes through onVisible
    if (running) return schedule(delay);
    running = true; lastRun = env.now();
    try { delay = (await task()) === false ? Math.min(opts.maxMs ?? ms, delay * 2) : ms; } catch { delay = Math.min(opts.maxMs ?? ms, delay * 2); }
    running = false;
    schedule(delay);
  };
  const off = env.onVisible(() => { if (!stopped && timer === null && !running) schedule(env.now() - lastRun >= delay ? 0 : delay - (env.now() - lastRun)); });
  if (opts.immediate !== false) void fire(); else schedule(ms);
  return () => { stopped = true; if (timer !== null) env.clearTimeout(timer); off(); };
}

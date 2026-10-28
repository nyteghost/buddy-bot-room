/** Limits how often a callback runs while keeping the newest value: the first call goes through at once (no added latency),
 *  calls inside the window collapse into one trailing call, and flush() delivers anything still waiting. */
export type Clock = { now(): number; setTimeout(fn: () => void, ms: number): unknown; clearTimeout(id: unknown): void };
export const systemClock: Clock = { now: () => Date.now(), setTimeout: (fn, ms) => setTimeout(fn, ms), clearTimeout: (id) => clearTimeout(id as ReturnType<typeof setTimeout>) };

export function createThrottle<T>(fn: (value: T) => void, ms: number, clock: Clock = systemClock) {
  let last = -Infinity;
  let pending: { value: T } | null = null;
  let timer: unknown = null;
  const run = () => {
    timer = null;
    if (!pending) return;
    const { value } = pending;
    pending = null;
    last = clock.now();
    fn(value);
  };
  return {
    push(value: T) {
      pending = { value };
      const wait = last + ms - clock.now();
      if (wait <= 0) { if (timer !== null) { clock.clearTimeout(timer); timer = null; } run(); }
      else if (timer === null) timer = clock.setTimeout(run, wait);
    },
    /** Deliver the waiting value now (end of stream, cancel, unmount). */
    flush() { if (timer !== null) { clock.clearTimeout(timer); timer = null; } run(); },
    /** Drop the waiting value. */
    cancel() { if (timer !== null) { clock.clearTimeout(timer); timer = null; } pending = null; },
    get waiting() { return pending !== null; },
  };
}

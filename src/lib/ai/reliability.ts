/** Small, dependency-free helpers for talking to a local model server that may be asleep, loading or restarting. */

export type RetryOptions = {
  /** Extra attempts after the first (default 2, so at most 3 tries; never unlimited). */
  retries?: number;
  baseMs?: number;
  maxMs?: number;
  signal?: AbortSignal;
  retryIf?: (e: unknown) => boolean;
  /** Called before each wait, for logging. */
  onRetry?: (attempt: number, e: unknown, waitMs: number) => void;
};

const TRANSIENT = /(ECONNREFUSED|ECONNRESET|ETIMEDOUT|EAI_AGAIN|ENOTFOUND|EHOSTUNREACH|fetch failed|socket hang up|network error|connection refused|model is loading|server busy)/i;

/** True for "try again in a moment" failures (server down, restarting, loading a model, 502/503/504), false for real errors. */
export function isTransient(e: unknown): boolean {
  if (!e || typeof e !== "object") return false;
  if ((e as { name?: string }).name === "AbortError") return false;
  const status = (e as { statusCode?: number; status?: number }).statusCode ?? (e as { status?: number }).status;
  if (status === 502 || status === 503 || status === 504 || status === 429) return true;
  const msg = e instanceof Error ? `${e.message} ${String((e as { cause?: unknown }).cause ?? "")}` : String(e);
  return TRANSIENT.test(msg);
}

export const backoffMs = (attempt: number, baseMs = 400, maxMs = 4000): number => Math.min(maxMs, baseMs * 2 ** Math.max(0, attempt - 1));

function sleep(ms: number, signal?: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    if (signal?.aborted) return reject(signal.reason ?? new DOMException("Aborted", "AbortError"));
    const t = setTimeout(() => { signal?.removeEventListener("abort", onAbort); resolve(); }, ms);
    const onAbort = () => { clearTimeout(t); reject(signal?.reason ?? new DOMException("Aborted", "AbortError")); };
    signal?.addEventListener("abort", onAbort, { once: true });
  });
}

/** Runs fn, retrying only transient failures with exponential backoff, a hard cap, and cancellation. */
export async function withRetry<T>(fn: (attempt: number) => Promise<T>, o: RetryOptions = {}): Promise<T> {
  const retries = Math.max(0, Math.min(5, o.retries ?? 2));
  const retryIf = o.retryIf ?? isTransient;
  for (let attempt = 1; ; attempt++) {
    try {
      return await fn(attempt);
    } catch (e) {
      if (o.signal?.aborted || attempt > retries || !retryIf(e)) throw e;
      const wait = backoffMs(attempt, o.baseMs, o.maxMs);
      o.onRetry?.(attempt, e, wait);
      await sleep(wait, o.signal);
    }
  }
}

/** A message a person can act on, instead of a raw network error. */
export function friendlyAiError(e: unknown): string {
  if (isTransient(e)) return "Local AI (Ollama) isn't answering. Check that the ollama container is running; if it runs on your PC, make sure the PC is awake.";
  if (e instanceof Error && e.name === "TimeoutError") return "The local model took too long to answer. Try a smaller model or a shorter question.";
  return e instanceof Error && e.message ? e.message : "The AI service could not complete this request.";
}

/** Remembers a recent good answer so a busy room doesn't probe the server before every single reply. */
export function makeProbe(check: () => Promise<void>, ttlMs = 5000, now: () => number = Date.now) {
  let okUntil = 0;
  return async (): Promise<void> => {
    if (now() < okUntil) return;
    await check();
    okUntil = now() + ttlMs;
  };
}

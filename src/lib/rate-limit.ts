/**
 * A small failed-attempt limiter for sign-in and similar checks. Memory only.
 * Each key (an address) gets `max` failures per window; on top of that the whole server gets `globalMax`, because
 * the address comes from a header (X-Forwarded-For) that anyone reaching the port directly can change.
 */
export type Limiter = {
  /** True when this key (or the whole server) has used up its failures for the current window. */
  blocked(key: string, now?: number): boolean;
  fail(key: string, now?: number): void;
  clear(key: string): void;
  reset(): void;
};

export function createLimiter(o: { max: number; windowMs: number; globalMax?: number; maxKeys?: number }): Limiter {
  const per = new Map<string, { n: number; first: number }>();
  let glob = { n: 0, first: 0 };
  const globalMax = o.globalMax ?? o.max * 5;
  const maxKeys = o.maxKeys ?? 2000;
  const live = (e: { first: number } | undefined, now: number) => !!e && now - e.first <= o.windowMs;
  return {
    blocked(key, now = Date.now()) {
      const e = per.get(key);
      if (e && !live(e, now)) per.delete(key);
      if (!live(glob.n ? glob : undefined, now)) glob = { n: 0, first: 0 };
      return (per.get(key)?.n ?? 0) >= o.max || glob.n >= globalMax;
    },
    fail(key, now = Date.now()) {
      const e = per.get(key);
      per.set(key, live(e, now) ? { n: e!.n + 1, first: e!.first } : { n: 1, first: now });
      while (per.size > maxKeys) { const oldest = per.keys().next().value; if (oldest === undefined) break; per.delete(oldest); }
      glob = live(glob.n ? glob : undefined, now) ? { n: glob.n + 1, first: glob.first } : { n: 1, first: now };
    },
    clear(key) { per.delete(key); },
    reset() { per.clear(); glob = { n: 0, first: 0 }; },
  };
}

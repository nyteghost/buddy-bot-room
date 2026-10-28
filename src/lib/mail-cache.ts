/**
 * Small in-memory cache for mail metadata and recently opened messages. Memory only: nothing is written to disk, a restart empties it,
 * and entries are removed by age, by count and by total size. Callers put the account in the key, so accounts never see each other's data.
 */
export type MailCache<T> = {
  get: (key: string, now?: number, maxAgeMs?: number) => T | undefined;
  set: (key: string, value: T, now?: number) => void;
  delete: (key: string) => void;
  deleteWhere: (pred: (key: string) => boolean) => void;
  clear: () => void;
  readonly size: number;
  readonly cost: number;
};

export function createMailCache<T>(o: { ttlMs: number; max: number; maxCost?: number; cost?: (v: T) => number }): MailCache<T> {
  const map = new Map<string, { v: T; at: number; cost: number }>();
  let total = 0;
  const drop = (k: string) => { const e = map.get(k); if (e) { total -= e.cost; map.delete(k); } };
  return {
    get(key, now = Date.now(), maxAgeMs = o.ttlMs) {
      if (o.ttlMs <= 0 || maxAgeMs <= 0) return undefined;
      const e = map.get(key);
      if (!e) return undefined;
      if (now - e.at > o.ttlMs) { drop(key); return undefined; }
      if (now - e.at > maxAgeMs) return undefined; // too old for this caller, but another caller may still accept it
      map.delete(key); map.set(key, e); // most recently used goes last
      return e.v;
    },
    set(key, value, now = Date.now()) {
      if (o.ttlMs <= 0 || o.max <= 0) return;
      const cost = o.cost ? o.cost(value) : 1;
      if (o.maxCost !== undefined && cost > o.maxCost) return;
      drop(key);
      map.set(key, { v: value, at: now, cost });
      total += cost;
      while (map.size > o.max || (o.maxCost !== undefined && total > o.maxCost)) { const oldest = map.keys().next().value; if (oldest === undefined) break; drop(oldest); }
    },
    delete: drop,
    deleteWhere(pred) { for (const k of [...map.keys()]) if (pred(k)) drop(k); },
    clear() { map.clear(); total = 0; },
    get size() { return map.size; },
    get cost() { return total; },
  };
}

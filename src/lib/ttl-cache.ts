/** Tiny in-memory cache with an expiry and a size cap (oldest entry goes first). */
export class TtlCache<V> {
  private map = new Map<string, { at: number; value: V }>();
  private ttlMs: number;
  private max: number;
  constructor(ttlMs: number, max: number) { this.ttlMs = ttlMs; this.max = max; }
  get(key: string, now = Date.now()): V | undefined {
    const hit = this.map.get(key);
    if (!hit) return undefined;
    if (now - hit.at > this.ttlMs) { this.map.delete(key); return undefined; }
    return hit.value;
  }
  clear(): void { this.map.clear(); }
  set(key: string, value: V, now = Date.now()): void {
    this.map.delete(key);
    this.map.set(key, { at: now, value });
    while (this.map.size > this.max) {
      const oldest = this.map.keys().next().value;
      if (oldest === undefined) break;
      this.map.delete(oldest);
    }
  }
  get size() { return this.map.size; }
}

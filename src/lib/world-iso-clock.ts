/**
 * Deterministic, capped simulation clock for the isolated Step 1b preview.
 * It is kept in a ref across parent rerenders. Paused frames never call advance.
 * Long suspended/throttled frames lose wall-clock time rather than cause a
 * simulation catch-up burst; this is deliberate for safety and CPU limits.
 */
export class WorldIsoClock {
 private elapsed = 0;
 private last = 0;
 private dropped = 0;
 static readonly MAX_FRAME_MS = 200;

 get elapsedMs(): number { return this.elapsed; }
 get lastAdvanceMs(): number { return this.last; }
 get droppedMs(): number { return this.dropped; }

 advance(dtMs: number): number {
  if (!Number.isFinite(dtMs) || dtMs <= 0) { this.last = 0; return this.elapsed; }
  this.last = Math.min(dtMs, WorldIsoClock.MAX_FRAME_MS);
  this.dropped += dtMs - this.last;
  this.elapsed += this.last;
  return this.elapsed;
 }
 pause(): void { this.last = 0; }
}

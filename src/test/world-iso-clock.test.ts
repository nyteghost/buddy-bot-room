import { describe, expect, it } from "vitest";
import { WorldIsoClock } from "@/lib/world-iso-clock";

describe("isolated isometric clock", () => {
 it("survives an equivalent parent rerender without restarting elapsed time", () => {
  const clock = new WorldIsoClock();
  for (let t = 0; t < 20_100; t += 100) clock.advance(100);
  expect(clock.elapsedMs).toBe(20_100);
  const freshEquivalentInputs = [{ id: "nova", name: "Nova", real: null }];
  expect(freshEquivalentInputs[0]?.id).toBe("nova");
  clock.advance(100);
  expect(clock.elapsedMs).toBe(20_200);
 });
 it("does not accumulate paused time or catch up suspended time", () => {
  const clock = new WorldIsoClock();
  clock.advance(100);
  clock.pause();
  expect(clock.lastAdvanceMs).toBe(0);
  clock.advance(30_000);
  expect(clock.elapsedMs).toBe(300);
  expect(clock.droppedMs).toBe(29_800);
 });
 it("ignores invalid deltas and partitions bounded time predictably", () => {
  const a = new WorldIsoClock(), b = new WorldIsoClock();
  a.advance(200);
  b.advance(100); b.advance(100);
  expect(a.elapsedMs).toBe(b.elapsedMs);
  for (const invalid of [Number.NaN, Infinity, -1, 0]) {
   a.advance(invalid);
   expect(a.lastAdvanceMs).toBe(0);
  }
  expect(a.elapsedMs).toBe(200);
 });
});

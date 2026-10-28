import { describe, expect, it } from "vitest";
import { createThrottle, type Clock } from "@/lib/stream-throttle";
import { createDebouncedSaver } from "@/lib/debounced-save";

function fakeClock() {
  let t = 0, id = 0;
  const timers = new Map<number, { at: number; fn: () => void }>();
  const clock: Clock = {
    now: () => t,
    setTimeout: (fn, ms) => { timers.set(++id, { at: t + ms, fn }); return id; },
    clearTimeout: (h) => { timers.delete(h as number); },
  };
  const advance = (ms: number) => {
    const end = t + ms;
    for (;;) {
      const next = [...timers.entries()].filter(([, v]) => v.at <= end).sort((a, b) => a[1].at - b[1].at)[0];
      if (!next) break;
      timers.delete(next[0]); t = next[1].at; next[1].fn();
    }
    t = end;
  };
  return { clock, advance };
}

describe("stream throttle", () => {
  it("delivers the first value at once and collapses a burst into one trailing call with the newest value", () => {
    const { clock, advance } = fakeClock();
    const seen: number[] = [];
    const th = createThrottle<number>((v) => seen.push(v), 50, clock);
    th.push(1); th.push(2); th.push(3);
    expect(seen).toEqual([1]);
    advance(50);
    expect(seen).toEqual([1, 3]);
  });
  it("flush delivers the waiting value immediately and cancel drops it", () => {
    const { clock } = fakeClock();
    const seen: number[] = [];
    const th = createThrottle<number>((v) => seen.push(v), 50, clock);
    th.push(1); th.push(2);
    th.flush();
    expect(seen).toEqual([1, 2]);
    th.push(3); th.push(4); th.cancel();
    th.flush();
    expect(seen).toEqual([1, 2]);
  });
  it("never loses the final value", () => {
    const { clock, advance } = fakeClock();
    const seen: number[] = [];
    const th = createThrottle<number>((v) => seen.push(v), 50, clock);
    for (let i = 1; i <= 100; i++) { th.push(i); advance(7); }
    th.flush();
    expect(seen.at(-1)).toBe(100);
    expect(seen.length).toBeLessThan(30);
  });
});

describe("debounced save", () => {
  it("saves once after changes go quiet", () => {
    const { clock, advance } = fakeClock();
    let saves = 0;
    const s = createDebouncedSaver(() => saves++, 500, 2000, clock);
    for (let i = 0; i < 20; i++) { s.schedule(); advance(20); }
    expect(saves).toBe(0);
    advance(500);
    expect(saves).toBe(1);
  });
  it("still saves during a long stream (max wait) and flush writes at once", () => {
    const { clock, advance } = fakeClock();
    let saves = 0;
    const s = createDebouncedSaver(() => saves++, 500, 2000, clock);
    for (let i = 0; i < 300; i++) { s.schedule(); advance(20); } // 6 s of constant changes
    expect(saves).toBeGreaterThanOrEqual(2);
    expect(saves).toBeLessThanOrEqual(4);
    s.schedule(); s.flush();
    expect(s.dirty).toBe(false);
    const before = saves;
    s.flush();
    expect(saves).toBe(before);
  });
});

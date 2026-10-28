import { describe, expect, it } from "vitest";
import { startPolling, type PollEnv } from "@/lib/poll";

function fakeEnv() {
  let t = 0, id = 0, hidden = false;
  const timers = new Map<number, { at: number; fn: () => void }>();
  const listeners: (() => void)[] = [];
  const env: PollEnv = {
    now: () => t, hidden: () => hidden,
    setTimeout: (fn, ms) => { timers.set(++id, { at: t + ms, fn }); return id; },
    clearTimeout: (h) => { timers.delete(h as number); },
    onVisible: (fn) => { listeners.push(fn); return () => { listeners.splice(listeners.indexOf(fn), 1); }; },
  };
  const advance = async (ms: number) => {
    const end = t + ms;
    for (let i = 0; i < 5; i++) await Promise.resolve();
    for (;;) {
      const next = [...timers.entries()].filter(([, v]) => v.at <= end).sort((a, b) => a[1].at - b[1].at)[0];
      if (!next) break;
      timers.delete(next[0]); t = next[1].at; next[1].fn();
      await Promise.resolve(); await Promise.resolve(); await Promise.resolve();
    }
    t = end;
  };
  return { env, advance, setHidden: (h: boolean) => { hidden = h; if (!h) listeners.forEach((l) => l()); } };
}

describe("startPolling", () => {
  it("polls on schedule while visible and stops asking while the tab is hidden", async () => {
    const f = fakeEnv();
    let calls = 0;
    const stop = startPolling(async () => { calls++; }, 1000, { env: f.env });
    await f.advance(5000);
    const visibleCalls = calls;
    expect(visibleCalls).toBeGreaterThanOrEqual(5);
    f.setHidden(true);
    await f.advance(60_000);
    expect(calls - visibleCalls).toBeLessThanOrEqual(1);
    stop();
  });
  it("catches up right away when the tab becomes visible again", async () => {
    const f = fakeEnv();
    let calls = 0;
    startPolling(async () => { calls++; }, 1000, { env: f.env });
    await f.advance(1500);
    f.setHidden(true);
    await f.advance(20_000);
    const before = calls;
    f.setHidden(false);
    await f.advance(1);
    expect(calls).toBe(before + 1);
  });
  it("backs off while the task keeps failing and recovers on success", async () => {
    const f = fakeEnv();
    let calls = 0, ok = false;
    startPolling(async () => { calls++; return ok; }, 1000, { env: f.env, maxMs: 8000 });
    await f.advance(60_000);
    expect(calls).toBeLessThan(15); // would be 60 without backoff
    ok = true;
    await f.advance(20_000);
    const afterRecovery = calls;
    await f.advance(5000);
    expect(calls - afterRecovery).toBeGreaterThanOrEqual(4);
  });
  it("never runs two at once and stops cleanly", async () => {
    const f = fakeEnv();
    let active = 0, peak = 0;
    const stop = startPolling(() => { active++; peak = Math.max(peak, active); return new Promise<void>((ok) => { setTimeout(() => { active--; ok(); }, 5); }); }, 1, { env: f.env });
    await f.advance(100);
    expect(peak).toBe(1);
    stop();
    await f.advance(100);
    expect(active).toBeLessThanOrEqual(1);
  });
});

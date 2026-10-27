import { describe, expect, it } from "vitest";
import { createJobRunner } from "@/lib/job-runner";

const wait = (ms: number) => new Promise<void>((ok) => setTimeout(ok, ms));

describe("job runner", () => {
  it("skips a job that is still running instead of starting a second copy", async () => {
    const r = createJobRunner();
    let starts = 0;
    const slow = () => { starts++; return wait(60); };
    const first = r.run("tick", slow, { timeoutMs: 1000 });
    expect(await r.run("tick", slow, { timeoutMs: 1000 })).toBe("skipped");
    expect(await first).toBe("done");
    expect(starts).toBe(1);
    expect(r.state("tick")?.skipped).toBe(1);
    expect(await r.run("tick", slow, { timeoutMs: 1000 })).toBe("done"); // free again afterwards
  });
  it("runs different jobs side by side, so a slow one does not block the others", async () => {
    const r = createJobRunner();
    const order: string[] = [];
    const slow = r.run("ai", async () => { await wait(80); order.push("ai"); }, { timeoutMs: 1000 });
    await r.run("reminders", async () => { order.push("reminders"); }, { timeoutMs: 1000 });
    await slow;
    expect(order).toEqual(["reminders", "ai"]);
  });
  it("a lane of 1 queues inference jobs in order", async () => {
    const r = createJobRunner();
    const log: string[] = [];
    const job = (n: string) => r.run(n, async () => { log.push(`${n}:start`); await wait(20); log.push(`${n}:end`); }, { timeoutMs: 1000, lane: "gpu" });
    await Promise.all([job("a"), job("b"), job("c")]);
    expect(log).toEqual(["a:start", "a:end", "b:start", "b:end", "c:start", "c:end"]);
  });
  it("times out a stuck job, aborts its signal and frees the slot", async () => {
    const r = createJobRunner();
    let aborted = false;
    const res = await r.run("stuck", (signal) => { signal.addEventListener("abort", () => { aborted = true; }); return new Promise(() => undefined); }, { timeoutMs: 30, lane: "gpu" });
    expect(res).toBe("timeout");
    expect(aborted).toBe(true);
    expect(await r.run("next", async () => undefined, { timeoutMs: 1000, lane: "gpu" })).toBe("done");
    expect(r.state("stuck")?.lastResult).toBe("timeout");
  });
  it("cancels a running job and a job waiting in the lane", async () => {
    const r = createJobRunner();
    const running = r.run("one", (signal) => new Promise<void>((_, no) => signal.addEventListener("abort", () => no(new Error("x")))), { timeoutMs: 1000, lane: "gpu" });
    const waiting = r.run("two", async () => undefined, { timeoutMs: 1000, lane: "gpu" });
    await wait(10);
    expect(r.cancel("two")).toBe(true);
    expect(await waiting).toBe("cancelled");
    expect(r.cancel("one")).toBe(true);
    expect(await running).toBe("cancelled");
    expect(r.cancel("one")).toBe(false);
  });
  it("retries a failing job a limited number of times with backoff, then reports the failure", async () => {
    const events: string[] = [];
    const r = createJobRunner((_, t) => events.push(t));
    let tries = 0;
    const res = await r.run("flaky", async () => { tries++; throw new Error("boom"); }, { timeoutMs: 1000, retries: 2, backoffMs: 5 });
    expect(res).toBe("failed");
    expect(tries).toBe(3);
    expect(r.state("flaky")?.lastError).toBe("boom");
    expect(events.some((e) => e.includes("flaky failed: boom"))).toBe(true);
    let n = 0;
    expect(await r.run("heals", async () => { if (++n < 2) throw new Error("once"); }, { timeoutMs: 1000, retries: 2, backoffMs: 5 })).toBe("done");
    expect(r.state("heals")?.lastError).toBeUndefined();
  });
});

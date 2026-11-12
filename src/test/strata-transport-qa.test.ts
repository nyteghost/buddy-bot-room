import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { strataModels, strataSdkFetch, StrataError, strataTokenLimit } from "@/lib/strata.server";

const base = "http://100.80.10.20:8090/v1";
const keys = ["STRATA_ENABLED", "STRATA_URL", "STRATA_API_KEY", "STRATA_MODEL"] as const;
const original = Object.fromEntries(keys.map(k => [k, process.env[k]]));
const model = "qa-test-model";
beforeEach(() => {
  process.env["STRATA_ENABLED"] = "on";
  process.env["STRATA_URL"] = base;
  process.env["STRATA_API_KEY"] = "NOT-A-REAL-SECRET";
  process.env["STRATA_MODEL"] = model;
});
afterEach(() => {
  for (const k of keys) {
    const value = original[k];
    if (value === undefined) delete process.env[k]; else process.env[k] = value;
  }
  vi.restoreAllMocks();
});

describe("Strata transport independent P1/P2 regression", () => {
  it.each([
    [401, "auth"], [403, "auth"], [404, "model"], [429, "busy"], [502, "offline"],
  ] as const)("cancels unconsumed HTTP %i bodies before reporting %s", async (status, code) => {
    const cancelled = vi.fn();
    vi.spyOn(globalThis, "fetch").mockImplementation(async () => new Response(new ReadableStream<Uint8Array>({
      cancel: cancelled,
    }), { status }));
    await expect(strataModels()).rejects.toMatchObject({ code });
    expect(cancelled).toHaveBeenCalledTimes(1);
    expect(vi.mocked(fetch)).toHaveBeenCalledTimes(1);
  });

  it("two parallel 403s release both slots immediately for a successful request", async () => {
    const cancelled = vi.fn();
    let requests = 0;
    vi.spyOn(globalThis, "fetch").mockImplementation(async () => {
      requests++;
      if (requests <= 2) return new Response(new ReadableStream<Uint8Array>({ cancel: cancelled }), { status: 403 });
      return Response.json({ data: [{ id: model, status: { value: "loaded" } }] });
    });
    const failures = await Promise.allSettled([strataModels(), strataModels()]);
    expect(failures).toHaveLength(2);
    for (const result of failures) {
      expect(result.status).toBe("rejected");
      if (result.status === "rejected") expect(result.reason).toMatchObject({ code: "auth" });
    }
    expect(cancelled).toHaveBeenCalledTimes(2);
    expect((await strataModels())[0]?.id).toBe(model);
    expect(requests).toBe(3);
  });

  it("2 active + 4 queued are bounded; the seventh is busy, and abort frees a queued position", async () => {
    const cancelled = vi.fn();
    const upstream = vi.spyOn(globalThis, "fetch").mockImplementation(async () =>
      new Response(new ReadableStream<Uint8Array>({ cancel: cancelled })));
    const first = await strataSdkFetch(base + "/models");
    const second = await strataSdkFetch(base + "/models");
    const controllers = Array.from({ length: 4 }, () => new AbortController());
    const waiters = controllers.map(c => strataSdkFetch(base + "/models", { signal: c.signal }).catch(e => e as Error));
    const saturated = await strataModels().catch(e => e as StrataError);
    expect(saturated).toBeInstanceOf(StrataError);
    if (saturated instanceof StrataError) expect(saturated.code).toBe("busy");
    expect(upstream).toHaveBeenCalledTimes(2);

    controllers[0]!.abort();
    const removed = await waiters[0]!;
    expect(removed).toBeInstanceOf(StrataError);
    if (removed instanceof StrataError) expect(removed.code).toBe("busy");
    expect(upstream).toHaveBeenCalledTimes(2);

    await first.body!.cancel();
    for (let i = 1; i < waiters.length; i++) {
      const granted = await waiters[i]!;
      expect(granted).toBeInstanceOf(Response);
      if (granted instanceof Response) await granted.body!.cancel();
    }
    await second.body!.cancel();
    const recovered = await strataSdkFetch(base + "/models");
    await recovered.body!.cancel();
    expect(upstream).toHaveBeenCalledTimes(6);
    expect(cancelled).toHaveBeenCalledTimes(6);
  });

  it("preserves caller output budgets and rejects nonpositive/malformed limits", () => {
    expect(strataTokenLimit(900)).toBe(900);
    expect(strataTokenLimit(80)).toBe(80);
    expect(strataTokenLimit(4001)).toBe(4000);
    expect(strataTokenLimit()).toBe(1024);
    for (const bad of [0, -5, 1.5, Number.NaN, Number.POSITIVE_INFINITY])
      expect(() => strataTokenLimit(bad)).toThrow(StrataError);
  });
});


describe("final QA: AI SDK streaming HTTP status cleanup", () => {
  it.each([
    [401, "auth"], [403, "auth"], [404, "model"], [429, "busy"], [503, "offline"],
  ] as const)("cancels unfinished SDK completion %i immediately and returns sanitized %s category", async (status, code) => {
    const cancel = vi.fn();
    const upstream = vi.spyOn(globalThis, "fetch").mockImplementation(async () =>
      new Response(new ReadableStream<Uint8Array>({ cancel }), { status }));
    const result = await strataSdkFetch(base + "/chat/completions", { method: "POST", body: "{}" });
    expect(result.status).toBe(status);
    expect(cancel).toHaveBeenCalledTimes(1);
    const payload = await result.json() as { error: { code: string; message: string } };
    expect(payload.error.code).toBe("strata-" + code);
    expect(JSON.stringify(payload)).not.toContain("NOT-A-REAL-SECRET");
    expect(upstream).toHaveBeenCalledTimes(1);
  });

  it("two unfinished SDK failures release capacity before third request; no upstream body reaches SDK", async () => {
    const cancel = vi.fn();
    let sent = 0;
    vi.spyOn(globalThis, "fetch").mockImplementation(async () => {
      sent++;
      return sent <= 2
        ? new Response(new ReadableStream<Uint8Array>({ cancel }), { status: 429 })
        : Response.json({ data: [{ id: model, status: { value: "loaded" } }] });
    });
    const results = await Promise.all([
      strataSdkFetch(base + "/chat/completions", { method: "POST", body: "{}" }),
      strataSdkFetch(base + "/chat/completions", { method: "POST", body: "{}" }),
    ]);
    expect(results.map(r => r.status)).toEqual([429, 429]);
    expect(cancel).toHaveBeenCalledTimes(2);
    expect((await strataModels())[0]?.id).toBe(model);
    expect(sent).toBe(3);
  });

  it("aborted SDK completion frees a slot even when the upstream never finishes headers", async () => {
    const cancelled = vi.fn();
    let calls = 0;
    let started!: () => void;
    const inFlight = new Promise<void>(resolve => { started = resolve; });
    vi.spyOn(globalThis, "fetch").mockImplementation(async (_input, init) => {
      calls++;
      if (calls === 1) return new Promise<Response>((_resolve, reject) => {
        started();
        const signal = init?.signal;
        if (signal?.aborted) { reject(new Error("aborted")); return; }
        signal?.addEventListener("abort", () => { cancelled(); reject(new Error("aborted")); }, { once: true });
      });
      return Response.json({ data: [{ id: model }] });
    });
    const controller = new AbortController();
    const pending = strataSdkFetch(base + "/chat/completions", { method: "POST", signal: controller.signal });
    await inFlight;
    controller.abort();
    await expect(pending).rejects.toMatchObject({ code: "offline" });
    expect(cancelled).toHaveBeenCalledTimes(1);
    expect((await strataModels())[0]?.id).toBe(model);
    expect(calls).toBe(2);
  });
});


describe("final QA: cancellation and timeout hardening", () => {
  it("releases capacity even when an upstream error body never completes cancellation", async () => {
    const cancelled = vi.fn();
    let count = 0;
    vi.spyOn(globalThis, "fetch").mockImplementation(async () => {
      count++;
      if (count === 1)
        return new Response(new ReadableStream<Uint8Array>({
          cancel() { cancelled(); return new Promise<void>(() => {}); },
        }), { status: 401 });
      return Response.json({ data: [{ id: model }] });
    });
    const response = await strataSdkFetch(base + "/chat/completions", { method: "POST", body: "{}" });
    expect(response.status).toBe(401);
    expect(cancelled).toHaveBeenCalledTimes(1);
    expect((await strataModels())[0]?.id).toBe(model);
    expect(count).toBe(2);
  });

  it("aborts a stalled HTTP request at its total deadline and recovers capacity", async () => {
    vi.useFakeTimers();
    try {
      let started!: () => void;
      const inFlight = new Promise<void>(resolve => { started = resolve; });
      let count = 0;
      vi.spyOn(globalThis, "fetch").mockImplementation(async (_input, init) => {
        count++;
        if (count === 1) return new Promise<Response>((_resolve, reject) => {
          started();
          init?.signal?.addEventListener("abort", () => reject(new Error("timeout")), { once: true });
        });
        return Response.json({ data: [{ id: model }] });
      });
      const pending = strataSdkFetch(base + "/chat/completions", { method: "POST" });
      await inFlight;
      await vi.advanceTimersByTimeAsync(120_001);
      await expect(pending).rejects.toMatchObject({ code: "offline" });
      expect((await strataModels())[0]?.id).toBe(model);
      expect(count).toBe(2);
    } finally {
      vi.useRealTimers();
    }
  });
});

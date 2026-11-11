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

import { describe, expect, it, vi } from "vitest";
import { backoffMs, friendlyAiError, isTransient, makeProbe, withRetry } from "@/lib/ai/reliability";

const refused = () => Object.assign(new Error("connect ECONNREFUSED 10.0.0.5:11434"), { code: "ECONNREFUSED" });

describe("AI reliability helpers", () => {
  it("tells transient failures from real ones", () => {
    expect(isTransient(refused())).toBe(true);
    expect(isTransient(new TypeError("fetch failed"))).toBe(true);
    expect(isTransient(Object.assign(new Error("x"), { statusCode: 503 }))).toBe(true);
    expect(isTransient(Object.assign(new Error("bad key"), { statusCode: 401 }))).toBe(false);
    expect(isTransient(new Error("model not found"))).toBe(false);
    expect(isTransient(Object.assign(new Error("aborted"), { name: "AbortError" }))).toBe(false);
    expect(isTransient(undefined)).toBe(false);
  });

  it("backs off exponentially up to a cap", () => {
    expect([1, 2, 3, 4, 5, 6].map((n) => backoffMs(n, 100, 1000))).toEqual([100, 200, 400, 800, 1000, 1000]);
  });

  it("retries a transient failure a limited number of times, then succeeds", async () => {
    const fn = vi.fn().mockRejectedValueOnce(refused()).mockRejectedValueOnce(refused()).mockResolvedValue("ok");
    await expect(withRetry(fn, { retries: 2, baseMs: 1 })).resolves.toBe("ok");
    expect(fn).toHaveBeenCalledTimes(3);
  });

  it("gives up after the cap instead of looping forever", async () => {
    const fn = vi.fn().mockRejectedValue(refused());
    await expect(withRetry(fn, { retries: 2, baseMs: 1 })).rejects.toThrow(/ECONNREFUSED/);
    expect(fn).toHaveBeenCalledTimes(3);
    const many = vi.fn().mockRejectedValue(refused());
    await expect(withRetry(many, { retries: 999, baseMs: 1, maxMs: 1 })).rejects.toThrow();
    expect(many.mock.calls.length).toBeLessThanOrEqual(6); // hard ceiling of 5 retries
  });

  it("does not retry real errors, so nothing is answered twice", async () => {
    const fn = vi.fn().mockRejectedValue(new Error("model not found"));
    await expect(withRetry(fn, { retries: 3, baseMs: 1 })).rejects.toThrow("model not found");
    expect(fn).toHaveBeenCalledTimes(1);
  });

  it("stops waiting when cancelled", async () => {
    const ac = new AbortController();
    const fn = vi.fn().mockRejectedValue(refused());
    const p = withRetry(fn, { retries: 3, baseMs: 5000, signal: ac.signal });
    setTimeout(() => ac.abort(), 10);
    await expect(p).rejects.toBeDefined();
    expect(fn).toHaveBeenCalledTimes(1);
  });

  it("gives people actionable messages", () => {
    expect(friendlyAiError(refused())).toMatch(/ollama container is running/i);
    expect(friendlyAiError(Object.assign(new Error("t"), { name: "TimeoutError" }))).toMatch(/too long/);
    expect(friendlyAiError(new Error("Something specific"))).toBe("Something specific");
  });

  it("probe remembers a good answer for the ttl and re-checks after", async () => {
    let t = 0;
    const check = vi.fn().mockResolvedValue(undefined);
    const probe = makeProbe(check, 1000, () => t);
    await probe(); await probe();
    expect(check).toHaveBeenCalledTimes(1);
    t = 1500; await probe();
    expect(check).toHaveBeenCalledTimes(2);
  });

  it("probe does not remember a failure", async () => {
    const check = vi.fn().mockRejectedValueOnce(refused()).mockResolvedValue(undefined);
    const probe = makeProbe(check, 1000, () => 0);
    await expect(probe()).rejects.toBeDefined();
    await expect(probe()).resolves.toBeUndefined();
    expect(check).toHaveBeenCalledTimes(2);
  });
});

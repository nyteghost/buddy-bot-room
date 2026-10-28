import { describe, expect, it } from "vitest";
import { keepAliveSetting, ollamaApi, prepareModel, touchKeepAlive, type OllamaApi } from "@/lib/ollama-runtime.server";

const GB = 1024 ** 3;
const fake = (o: { installed?: { name: string; gb: number }[]; loaded?: { name: string; sizeVramBytes: number }[]; failOn?: Record<string, string> } = {}) => {
  const calls: { model: string; keepAlive: string | null }[] = [];
  const api: OllamaApi = {
    installed: async () => o.installed ?? [],
    loaded: async () => o.loaded ?? [],
    load: async (model, keepAlive) => { calls.push({ model, keepAlive }); if (o.failOn?.[model]) throw new Error(o.failOn[model]); },
  };
  return { api, calls };
};
const INSTALLED = [{ name: "big:30b", gb: 18 }, { name: "mid:8b", gb: 5 }, { name: "small:3b", gb: 2 }, { name: "nomic-embed-text", gb: 0.3 }];
const OOM = "model requires more system memory (21.0 GiB) than is available (9.5 GiB)";

describe("prepareModel", () => {
  it("loads the model with the keep-alive and reports it as asked", async () => {
    const { api, calls } = fake({ installed: INSTALLED });
    const r = await prepareModel(api, { requested: "mid:8b", vramGb: 10, keepAlive: "30m" });
    expect(r).toMatchObject({ ok: true, model: "mid:8b", fellBack: false });
    expect(calls).toEqual([{ model: "mid:8b", keepAlive: "30m" }]);
  });
  it("does not reload a model that is already loaded", async () => {
    const { api, calls } = fake({ installed: INSTALLED, loaded: [{ name: "mid:8b", sizeVramBytes: 5 * GB }] });
    const r = await prepareModel(api, { requested: "mid:8b", vramGb: 10, keepAlive: "30m" });
    expect(r.ok && r.plan?.alreadyLoaded).toBe(true);
    expect(calls).toHaveLength(0);
  });
  it("falls back to the largest smaller installed model when memory runs out, and says so", async () => {
    const { api, calls } = fake({ installed: INSTALLED, failOn: { "big:30b": OOM } });
    const r = await prepareModel(api, { requested: "big:30b", vramGb: 10, keepAlive: "30m" });
    expect(r).toMatchObject({ ok: true, model: "mid:8b", requested: "big:30b", fellBack: true });
    expect(calls.map((c) => c.model)).toEqual(["big:30b", "mid:8b"]);
  });
  it("never falls back to an embedding model", async () => {
    const { api } = fake({ installed: [{ name: "big:30b", gb: 18 }, { name: "nomic-embed-text", gb: 0.3 }], failOn: { "big:30b": OOM } });
    const r = await prepareModel(api, { requested: "big:30b", vramGb: 10, keepAlive: null });
    expect(r.ok).toBe(false);
  });
  it("gives up with a plain message when the fallback does not fit either", async () => {
    const { api } = fake({ installed: INSTALLED, failOn: { "big:30b": OOM, "mid:8b": OOM } });
    const r = await prepareModel(api, { requested: "big:30b", vramGb: 0, keepAlive: null });
    expect(r.ok).toBe(false); // one fallback attempt, then a plain explanation
    expect(!r.ok && r.message).toContain("doesn't fit");
  });
  it("explains plainly when nothing smaller is installed", async () => {
    const { api } = fake({ installed: [{ name: "small:3b", gb: 2 }], failOn: { "small:3b": OOM } });
    const r = await prepareModel(api, { requested: "small:3b", vramGb: 2, keepAlive: null });
    expect(!r.ok && r.message).toMatch(/no smaller downloaded model/);
  });
  it("keeps the requested model when fallback is switched off", async () => {
    const { api } = fake({ installed: INSTALLED, failOn: { "big:30b": OOM } });
    expect((await prepareModel(api, { requested: "big:30b", vramGb: 10, keepAlive: null, allowFallback: false })).ok).toBe(false);
  });
  it("leaves non-memory load problems for the real reply to report", async () => {
    const { api } = fake({ installed: INSTALLED, failOn: { "mid:8b": "connection reset" } });
    expect(await prepareModel(api, { requested: "mid:8b", vramGb: 10, keepAlive: "30m" })).toMatchObject({ ok: true, model: "mid:8b", fellBack: false });
  });
  it("passes through a model that is not downloaded and survives an unreachable Ollama", async () => {
    expect(await prepareModel(fake({ installed: INSTALLED }).api, { requested: "ghost:1b", vramGb: 10, keepAlive: null })).toMatchObject({ ok: true, model: "ghost:1b" });
    const down: OllamaApi = { installed: async () => { throw new Error("nope"); }, loaded: async () => [], load: async () => {} };
    expect(await prepareModel(down, { requested: "mid:8b", vramGb: 10, keepAlive: null })).toMatchObject({ ok: true, model: "mid:8b" });
  });
});

describe("keep-alive", () => {
  it("defaults to 30 minutes, accepts valid values, ignores junk", () => {
    expect(keepAliveSetting({})).toBe("30m");
    expect(keepAliveSetting({ OLLAMA_KEEP_ALIVE: "2h" })).toBe("2h");
    expect(keepAliveSetting({ OLLAMA_KEEP_ALIVE: "-1" })).toBe("-1");
    expect(keepAliveSetting({ OLLAMA_KEEP_ALIVE: "forever" })).toBeNull();
  });
  it("touchKeepAlive re-arms the timer, skips unload-at-once, and never throws", async () => {
    const { api, calls } = fake();
    await touchKeepAlive(api, "mid:8b", "30m");
    await touchKeepAlive(api, "mid:8b", "0");
    await touchKeepAlive(api, "mid:8b", null);
    expect(calls).toEqual([{ model: "mid:8b", keepAlive: "30m" }]);
    await expect(touchKeepAlive(fake({ failOn: { x: "boom" } }).api, "x", "5m")).resolves.toBeUndefined();
  });
});

describe("ollamaApi", () => {
  it("reads tags and ps, and loads through the native endpoint with a numeric -1", async () => {
    const seen: { url: string; body?: unknown }[] = [];
    const f = (async (url: string, init?: RequestInit) => {
      seen.push({ url, ...(init?.body ? { body: JSON.parse(String(init.body)) } : {}) });
      if (url.endsWith("/api/tags")) return Response.json({ models: [{ name: "a:1b", size: 2 * GB }] });
      if (url.endsWith("/api/ps")) return Response.json({ models: [{ name: "a:1b", size_vram: GB }] });
      return Response.json({ done: true });
    }) as unknown as typeof fetch;
    const api = ollamaApi("http://ollama:11434", f);
    expect(await api.installed()).toEqual([{ name: "a:1b", gb: 2 }]);
    expect(await api.loaded()).toEqual([{ name: "a:1b", sizeVramBytes: GB }]);
    await api.load("a:1b", "-1");
    expect(seen.at(-1)).toEqual({ url: "http://ollama:11434/api/generate", body: { model: "a:1b", prompt: "", stream: false, keep_alive: -1 } });
  });
  it("surfaces Ollama's own error text so out-of-memory can be recognised", async () => {
    const f = (async () => Response.json({ error: OOM }, { status: 500 })) as unknown as typeof fetch;
    await expect(ollamaApi("http://o", f).load("m", null)).rejects.toThrow(/more system memory/);
  });
});

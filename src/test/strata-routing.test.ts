
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { strataConnection, strataModels, strataSdkFetch, StrataError } from "@/lib/strata.server";
import { assertInferenceAllowed, LocalOnlyError } from "@/lib/ai/guard.server";
import { askChain } from "@/lib/ask.server";
import { engineFromJson, providerForTurn } from "@/lib/engine";
import { dispatchTurn } from "@/lib/turn-dispatch";
import { handleChat } from "@/lib/chat.server";
import { agents, models } from "@/lib/agents";

const key = "FAKE-STRATA-KEY-TEST-ONLY";
const model = "qwen3.8-flash-next-coder-iq1_m";
const base = "http://100.80.10.20:8090/v1";
const keys = ["STRATA_ENABLED", "STRATA_URL", "STRATA_API_KEY", "STRATA_MODEL", "STRATA_FALLBACK", "LOCAL_ONLY_AI"] as const;
const saved = Object.fromEntries(keys.map(k => [k, process.env[k]]));
beforeEach(() => {
  process.env["STRATA_ENABLED"] = "on";
  process.env["STRATA_URL"] = base;
  process.env["STRATA_API_KEY"] = key;
  process.env["STRATA_MODEL"] = model;
  process.env["STRATA_FALLBACK"] = "off";
  process.env["LOCAL_ONLY_AI"] = "on";
});
afterEach(() => {
  for (const k of keys) {
    const original = saved[k];
    if (original === undefined) delete process.env[k]; else process.env[k] = original;
  }
  vi.restoreAllMocks();
});

describe("Strata opt-in routing security and Local-Only", () => {
  it("does not route injected external host, auth or port and never leaks the key", async () => {
    const calls: { url: string; authorization: string | null; redirect: string | undefined }[] = [];
    const intercepted = vi.spyOn(globalThis, "fetch").mockImplementation(async (input, init) => {
      const url = String(input);
      calls.push({ url, authorization: new Headers(init?.headers).get("authorization"), redirect: init?.redirect });
      return Response.json({ object: "list", data: [{ id: model, status: { value: "loaded" } }] });
    });
    await expect(strataSdkFetch("https://api.openai.com/v1/models", { headers: { Authorization: "Bearer attacker" } })).rejects.toMatchObject({ code: "config" });
    await expect(strataSdkFetch(base + "/admin")).rejects.toBeInstanceOf(StrataError);
    expect(intercepted).not.toHaveBeenCalled();
    const found = await strataModels();
    expect(found[0]?.id).toBe(model);
    expect(calls).toEqual([{ url: base + "/models", authorization: "Bearer " + key, redirect: "error" }]);
    expect(JSON.stringify(found)).not.toContain(key);
    expect(strataConnection().base).toBe(base);
  });

  it("allows the exact configured local host under Local-Only, never spoofed or cloud", () => {
    expect(() => assertInferenceAllowed("strata-server", base, "http://ollama:11434")).not.toThrow();
    for (const target of [base + ".evil", "http://10.1.2.3:8090/v1", "https://api.openai.com/v1", base + "/admin"]) {
      expect(() => assertInferenceAllowed("strata-server", target, "http://ollama:11434")).toThrow(LocalOnlyError);
    }
    expect(() => assertInferenceAllowed("anthropic", "https://api.anthropic.com/v1", "http://ollama:11434")).toThrow(LocalOnlyError);
    process.env["STRATA_ENABLED"] = "off";
    expect(() => assertInferenceAllowed("strata-server", base, "http://ollama:11434")).toThrow(LocalOnlyError);
  });

  it("makes explicit Strata engine the Pal and approved unattended route, not a cloud fallback", async () => {
    const settings = engineFromJson(JSON.stringify({ kind: "strata-server", groqKey: "fake-cloud", localChat: "auto" }));
    expect(providerForTurn(settings, 0)?.kind).toBe("strata-server");
    expect(askChain(settings, "summarize", true).map(p => p.kind)).toEqual(["strata-server"]);
    const called: string[] = [];
    await dispatchTurn({
      engine: { kind: "strata-server", ollamaUrl: "http://ollama:11434" },
      provider: providerForTurn(settings, 0), realData: true, localOnly: false, blockPaid: false,
      hasWebGpu: true, aborted: () => false, hasAnswer: () => false, clearAnswer: () => {},
      runChain: async p => { called.push(p.kind); }, localChain: async () => { called.push("ollama"); },
      runOllama: async () => { called.push("ollama"); }, runBrowserModel: async () => { called.push("browser"); },
      cloudFallback: async () => { called.push("cloud"); }, ollamaBenchedWithBackup: () => false,
      benchOllama: () => {}, log: () => {},
    });
    expect(called).toEqual(["strata-server"]);
    process.env["STRATA_FALLBACK"] = "ollama";
    process.env["OLLAMA_URL"] = "http://ollama:11434";
    expect(askChain(settings, "summarize", true).map(p => p.kind)).toEqual(["strata-server", "ollama-server"]);
    delete process.env["OLLAMA_URL"];
  });

  it("uses only the server-configured Strata model and bearer for a real Pal stream", async () => {
    const calls: { url: string; auth: string | null; body: string }[] = [];
    vi.spyOn(globalThis, "fetch").mockImplementation(async (input, init) => {
      const url = String(input);
      calls.push({ url, auth: new Headers(init?.headers).get("Authorization"), body: String(init?.body ?? "") });
      if (url.endsWith("/models")) return Response.json({ data: [{ id: model, status: { value: "loaded" } }] });
      if (url.endsWith("/chat/completions")) {
        const stream = [
          'data: {"id":"test","object":"chat.completion.chunk","choices":[{"index":0,"delta":{"role":"assistant","content":"Local Strata answer"},"finish_reason":null}]}',
          'data: {"id":"test","object":"chat.completion.chunk","choices":[{"index":0,"delta":{},"finish_reason":"stop"}]}',
          "data: [DONE]", "",
        ].join("\n\n");
        return new Response(stream, { headers: { "Content-Type": "text/event-stream" } });
      }
      throw Error("Unexpected outgoing request");
    });
    const res = await handleChat(new Request("http://local/api/chat", {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        agentId: agents[0]!.id, model: models[0]!.id, mode: "direct",
        messages: [{ id: "m1", role: "user", parts: [{ type: "text", text: "Hello" }] }],
        engine: { kind: "strata-server", apiKey: "FAKE-CLIENT-INJECTED", baseUrl: "https://api.openai.com/v1", model: "attacker-model" },
      }),
    }));
    expect(res.ok).toBe(true);
    expect(res.headers.get("x-pixelpals-model")).toBe(model);
    const response = await res.text();
    expect(response).toContain("Local Strata answer");
    expect(calls.every(c => c.url.startsWith(base))).toBe(true);
    expect(calls.every(c => c.auth === "Bearer " + key)).toBe(true);
    const requestBody = JSON.parse(calls.find(c => c.url.endsWith("/chat/completions"))!.body) as { model: string };
    expect(requestBody.model).toBe(model);
    expect(requestBody).not.toHaveProperty("tools");
    expect(response).not.toContain(key);
  });

  it("keeps cloud disabled when private Strata is offline", async () => {
    vi.spyOn(globalThis, "fetch").mockRejectedValue(new Error("PC sleeping"));
    const settings = engineFromJson(JSON.stringify({ kind: "strata-server", groqKey: "fake-cloud" }));
    expect(askChain(settings, "private task", true).map(p => p.kind)).toEqual(["strata-server"]);
    await expect(strataModels()).rejects.toMatchObject({ code: "offline" });
  });
  it("fails closed for wrong model, auth failures and a sleeping gaming PC", async () => {
    process.env["STRATA_MODEL"] = "another-loaded-model";
    vi.spyOn(globalThis, "fetch").mockResolvedValue(Response.json({ data: [{ id: model, status: { value: "loaded" } }] }));
    const { strataReadyModel } = await import("@/lib/strata.server");
    await expect(strataReadyModel()).rejects.toMatchObject({ code: "model" });
    process.env["STRATA_MODEL"] = model;
    for (const [status, code] of [[401, "auth"], [404, "model"], [429, "busy"]] as const) {
      vi.mocked(globalThis.fetch).mockResolvedValue(new Response("", { status }));
      await expect(strataModels()).rejects.toMatchObject({ code });
    }
    vi.mocked(globalThis.fetch).mockRejectedValue(new Error("Host went to sleep"));
    await expect(strataModels()).rejects.toMatchObject({ code: "offline" });
  });

  it("does not dispatch or retain streaming work after cancellation", async () => {
    const cancel = vi.fn();
    const controller = new AbortController();
    vi.spyOn(globalThis, "fetch").mockImplementation(async () => new Response(new ReadableStream<Uint8Array>({
      start(target) { target.enqueue(new TextEncoder().encode("data: part\\n\\n")); },
      cancel,
    }), { headers: { "Content-Type": "text/event-stream" } }));
    const response = await strataSdkFetch(base + "/chat/completions", { method: "POST", signal: controller.signal });
    const reader = response.body!.getReader();
    expect((await reader.read()).done).toBe(false);
    controller.abort();
    await reader.read();
    expect(cancel).toHaveBeenCalled();
    const already = new AbortController();
    already.abort();
    await expect(strataSdkFetch(base + "/chat/completions", { signal: already.signal }))
      .rejects.toMatchObject({ code: "offline" });
  });

});

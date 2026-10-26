import { afterEach, describe, expect, it, vi } from "vitest";
import { blockedMessage, engineAllowed, isLocalOnly, sameEndpoint } from "@/lib/local-only";
import { assertInferenceAllowed, LocalOnlyError, localOnlyOn } from "@/lib/ai/guard.server";
import { handleChat } from "@/lib/chat.server";
import { agents, models } from "@/lib/agents";

afterEach(() => { delete process.env["LOCAL_ONLY_AI"]; vi.restoreAllMocks(); });

describe("Local-Only AI mode", () => {
  it("is ON by default and only off when explicitly turned off", () => {
    expect(isLocalOnly(undefined)).toBe(true);
    expect(isLocalOnly("")).toBe(true);
    expect(isLocalOnly("on")).toBe(true);
    expect(isLocalOnly("garbage")).toBe(true);
    for (const off of ["off", "OFF", " 0 ", "false", "no"]) expect(isLocalOnly(off)).toBe(false);
  });

  it("allows only the stack's own Ollama while on", () => {
    expect(engineAllowed("ollama-server", true)).toBe(true);
    for (const k of ["groq", "gemini", "openrouter", "nvidia", "anthropic", "custom", "", undefined, null]) expect(engineAllowed(k, true)).toBe(false);
    for (const k of ["groq", "anthropic", "custom"]) expect(engineAllowed(k, false)).toBe(true);
  });

  it("names the blocked engine and says how to turn it off", () => {
    expect(blockedMessage("anthropic")).toMatch(/anthropic is blocked/);
    expect(blockedMessage("anthropic")).toMatch(/Local-Only AI/);
  });

  it("compares endpoints by scheme and host:port, not by lookalike text", () => {
    expect(sameEndpoint("http://ollama:11434/v1", "http://ollama:11434")).toBe(true);
    expect(sameEndpoint("http://ollama:11434.evil.com/v1", "http://ollama:11434")).toBe(false);
    expect(sameEndpoint("https://api.groq.com/openai/v1", "http://ollama:11434")).toBe(false);
    expect(sameEndpoint("http://ollama:11435/v1", "http://ollama:11434")).toBe(false);
    expect(sameEndpoint("not a url", "http://ollama:11434")).toBe(false);
  });

  it("guard blocks cloud engines and a mislabelled address, and allows the real Ollama", () => {
    expect(localOnlyOn()).toBe(true);
    const ollama = "http://ollama:11434";
    expect(() => assertInferenceAllowed("anthropic", "https://api.anthropic.com/v1", ollama)).toThrow(LocalOnlyError);
    expect(() => assertInferenceAllowed("groq", "https://api.groq.com/openai/v1", ollama)).toThrow(LocalOnlyError);
    // labelled "local" but pointing somewhere else
    expect(() => assertInferenceAllowed("ollama-server", "https://api.openai.com/v1", ollama)).toThrow(LocalOnlyError);
    // Ollama not configured at all
    expect(() => assertInferenceAllowed("ollama-server", "http://ollama:11434/v1", "")).toThrow(LocalOnlyError);
    expect(() => assertInferenceAllowed("ollama-server", "http://ollama:11434/v1", ollama)).not.toThrow();
  });

  it("guard lets cloud engines through only after Local-Only is turned off on purpose", () => {
    process.env["LOCAL_ONLY_AI"] = "off";
    expect(() => assertInferenceAllowed("groq", "https://api.groq.com/openai/v1", "")).not.toThrow();
  });

  it("the chat endpoint refuses a cloud engine before any network call, even with a key saved", async () => {
    const fetchSpy = vi.spyOn(globalThis, "fetch");
    const body = {
      agentId: agents[0]!.id,
      model: models[0]!.id,
      mode: "direct",
      messages: [{ id: "m1", role: "user", parts: [{ type: "text", text: "hello" }] }],
      engine: { kind: "anthropic", apiKey: "sk-ant-test-0000000000000000", model: "claude-haiku-5-5" },
    };
    const res = await handleChat(new Request("http://local/api/chat", { method: "POST", body: JSON.stringify(body) }));
    expect(res.status).toBe(403);
    expect(((await res.json()) as { code: string }).code).toBe("local-only");
    for (const kind of ["groq", "gemini", "openrouter", "nvidia", "custom"]) {
      const r = await handleChat(new Request("http://local/api/chat", { method: "POST", body: JSON.stringify({ ...body, engine: { ...body.engine, kind, baseUrl: "https://example.com/v1" } }) }));
      expect(r.status).toBe(403);
    }
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it("a local engine with no Ollama configured fails safely instead of falling back", async () => {
    const fetchSpy = vi.spyOn(globalThis, "fetch");
    const prev = process.env["OLLAMA_URL"]; delete process.env["OLLAMA_URL"];
    const body = {
      agentId: agents[0]!.id, model: models[0]!.id, mode: "direct",
      messages: [{ id: "m1", role: "user", parts: [{ type: "text", text: "hello" }] }],
      engine: { kind: "ollama-server", model: "qwen2.5:7b", groqKey: "gsk_" + "a".repeat(30) },
    };
    const res = await handleChat(new Request("http://local/api/chat", { method: "POST", body: JSON.stringify(body) }));
    expect(res.status).toBe(400);
    expect(fetchSpy).not.toHaveBeenCalled();
    if (prev !== undefined) process.env["OLLAMA_URL"] = prev;
  });
});

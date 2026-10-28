import { describe, expect, it } from "vitest";
import { explainAiError, providerMessage } from "@/lib/ai-error";

describe("AI error explanations", () => {
  it("finds the provider's message in each JSON shape", () => {
    expect(providerMessage('{"error":{"message":"Invalid API key"}}')).toBe("Invalid API key");
    expect(providerMessage('[{"error":{"code":429,"message":"Quota exceeded for model"}}]')).toBe("Quota exceeded for model");
    expect(providerMessage('{"error":"model busy"}')).toBe("model busy");
    expect(providerMessage('{"detail":"Function not found"}')).toBe("Function not found");
    expect(providerMessage('{"detail":[{"msg":"field required"}]}')).toBe("field required");
    expect(providerMessage('{"error":{"message":"Provider returned error","metadata":{"raw":"free model rate limited"}}}')).toBe("Provider returned error (free model rate limited)");
    expect(providerMessage("plain text failure")).toBe("plain text failure");
    expect(providerMessage("<html>502</html>")).toBeUndefined();
    expect(providerMessage("")).toBeUndefined();
  });
  it("adds the status and what it means", () => {
    expect(explainAiError({ statusCode: 429, responseBody: '{"error":{"message":"Rate limit reached"}}' })).toBe("Rate limit reached (HTTP 429): rate limit or free quota used up: wait a bit, or spread the pals over more keys");
    expect(explainAiError({ statusCode: 401, message: "Unauthorized" })).toContain("key was rejected");
    expect(explainAiError({ statusCode: 503, responseBody: "<html>" })).toContain("provider is having trouble");
  });
  it("never says nothing, and never leaks a key", () => {
    expect(explainAiError({})).toBe("The AI service failed without saying why");
    expect(explainAiError({ statusCode: 400, responseBody: "{}" })).toBe("The AI service answered with an error (HTTP 400)");
    expect(explainAiError(new Error("bad key gsk_abcdefghijklmnopqrstuvwxyz123456"))).not.toContain("gsk_abcdefghijklmnopqrstuvwxyz123456");
  });
});

import { benchMs, benchProvider, isBenched, orderByHealth, type Bench, type TurnProvider } from "@/lib/engine";
describe("skipping AIs that just failed", () => {
  const g: TurnProvider = { kind: "groq", apiKey: "k" };
  const m: TurnProvider = { kind: "gemini", apiKey: "k" };
  const o: TurnProvider = { kind: "openrouter", apiKey: "k" };
  it("moves a failed AI to the back for a few minutes, then trusts it again", () => {
    const bench: Bench = new Map();
    benchProvider(bench, g, new Error("Rate limit (HTTP 429)"), 1000);
    expect(orderByHealth([g, m, o], bench, 2000).map((p) => p.kind)).toEqual(["gemini", "openrouter", "groq"]);
    expect(isBenched(bench, g, 1000 + 3 * 60_000 - 1)).toBe(true);
    expect(orderByHealth([g, m, o], bench, 1000 + 3 * 60_000 + 1).map((p) => p.kind)).toEqual(["groq", "gemini", "openrouter"]);
  });
  it("benches a rejected key longer than a rate limit", () => {
    expect(benchMs(new Error("Invalid API key (HTTP 401)"))).toBeGreaterThan(benchMs(new Error("slow down (HTTP 429)")));
  });
  it("still tries every AI when all are benched", () => {
    const bench: Bench = new Map();
    for (const p of [g, m]) benchProvider(bench, p, new Error("x"), 0);
    expect(orderByHealth([g, m], bench, 10).length).toBe(2);
  });
});

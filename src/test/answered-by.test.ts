import { describe, expect, it } from "vitest";
import { answeredLabel, providerLabel } from "@/lib/engine";

describe("which model answered", () => {
  it("names the provider and its model, using the free default when none is set", () => {
    expect(providerLabel({ kind: "groq" })).toBe("Groq · gpt-oss-120b");
    expect(providerLabel({ kind: "ollama-server", model: "qwen2.5:7b" })).toBe("Ollama · qwen2.5:7b");
    expect(providerLabel({ kind: "openrouter", model: "meta-llama/llama-3.3-70b:free" })).toBe("OpenRouter · llama-3.3-70b:free");
  });
  it("shows the plain label normally", () => {
    expect(answeredLabel({ via: "Groq · gpt-oss-120b" })).toBe("Groq · gpt-oss-120b");
    expect(answeredLabel({})).toBe("");
  });
  it("says so when a smaller local model took over", () => {
    expect(answeredLabel({ via: "Ollama · qwen2.5:32b", model: "qwen2.5:7b", fellBackFrom: "qwen2.5:32b" })).toBe("Ollama · qwen2.5:7b (smaller model: qwen2.5:32b didn't fit)");
  });
  it("does not claim a fallback when the server reports only the model it used", () => {
    expect(answeredLabel({ via: "Ollama · qwen2.5:7b", model: "qwen2.5:7b" })).toBe("Ollama · qwen2.5:7b");
  });
});

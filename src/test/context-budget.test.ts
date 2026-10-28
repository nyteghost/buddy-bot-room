import { describe, expect, it } from "vitest";
import { buildContext, dedupeTurns, digestTurns, estimateTextTokens, transcriptBudgetChars, windowTokens, type Turn } from "@/lib/context-budget";

const turn = (role: string, text: string, speaker?: string): Turn => ({ role, text, ...(speaker ? { speaker } : {}) });

describe("context budget", () => {
  it("estimates tokens from characters, counting CJK heavier", () => {
    expect(estimateTextTokens("abcd".repeat(100))).toBe(100);
    expect(estimateTextTokens("你好".repeat(30))).toBeGreaterThan(30);
  });
  it("follows the engine window and never exceeds what the caller asked for", () => {
    expect(windowTokens("ollama-server")).toBe(4096);
    expect(transcriptBudgetChars("ollama-server", 12000)).toBeLessThan(12000);
    expect(transcriptBudgetChars("anthropic", 12000)).toBe(12000);
    expect(transcriptBudgetChars("groq", 3000)).toBe(3000);
    expect(transcriptBudgetChars("unknown-engine", 500)).toBe(2000);
  });
  it("drops a turn that was repeated by a retry, but keeps legitimate repeats from other speakers", () => {
    const out = dedupeTurns([turn("user", "hi"), turn("assistant", "hello", "Nova"), turn("assistant", "hello", "Nova"), turn("assistant", "hello", "Byte")]);
    expect(out.map((t) => t.speaker ?? t.role)).toEqual(["user", "Nova", "Byte"]);
  });
  it("keeps everything and adds no digest when the chat fits", () => {
    const b = buildContext([turn("user", "a"), turn("assistant", "b")], 4000);
    expect(b.dropped).toBe(0);
    expect(b.digest).toBe("");
    expect(b.kept).toHaveLength(2);
  });
  it("keeps the newest turns and turns dropped decisions into a digest within its share of the budget", () => {
    const filler = "Some long discussion about nothing in particular. ".repeat(12);
    const items = [turn("user", "We decided to use port 8090 for the stack. Anything else?"), ...Array.from({ length: 30 }, (_, i) => turn(i % 2 ? "user" : "assistant", `${filler} ${i}`, "Nova")), turn("user", "What was the port again?")];
    const b = buildContext(items, 3000);
    expect(b.dropped).toBeGreaterThan(0);
    expect(b.kept.at(-1)?.text).toBe("What was the port again?");
    expect(b.digest).toContain("8090");
    expect(b.digest.length).toBeLessThanOrEqual(600);
  });
  it("always keeps the latest turn even when it alone is over budget", () => {
    const b = buildContext([turn("user", "x".repeat(10000))], 2000);
    expect(b.kept).toHaveLength(1);
  });
  it("digest prefers human turns and turns with decisions, in time order, and names speakers", () => {
    const d = digestTurns([turn("assistant", "Interesting weather today and the forecast says it may rain later this week.", "Byte"), turn("user", "Let's go with the Tailscale plan."), turn("assistant", "I will check the schedule.", "Sage")], 100);
    expect(d.split("\n")[0]).toContain("Tailscale");
    expect(d).not.toContain("weather");
  });
  it("returns nothing when there is no room for a digest", () => {
    expect(digestTurns([turn("user", "We decided on X.")], 40)).toBe("");
  });
});

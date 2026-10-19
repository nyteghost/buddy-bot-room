import { describe, expect, it } from "vitest";
import { createThinkFilter, isReasoningModel, maxTokensFor, stripThinking } from "@/lib/think-filter";
import { replaceEmojiShortcodes } from "@/lib/emoji-shortcodes";
import { freshRecall, promptHistory, recallStep } from "@/lib/prompt-recall";
import { helpText, parseSlash, slashSuggestions } from "@/lib/slash-commands";

function run(chunks: string[]) {
  const f = createThinkFilter();
  return chunks.map((c) => f.push(c)).join("") + f.flush();
}

describe("think filter", () => {
  it("removes an inline thought", () => expect(run(["<think>hmm</think>Hello there"])).toBe("Hello there"));
  it("handles tags split across chunks", () =>
    expect(run(["<thi", "nk>plan", " it</th", "ink>\n\nAnswer: ", "42"])).toBe("Answer: 42"));
  it("streams plain text straight through", () => expect(run(["a ", "b ", "c"])).toBe("a b c"));
  it("keeps a lone less-than sign", () => expect(run(["1 < 2 and ", "3 > 2"])).toBe("1 < 2 and 3 > 2"));
  it("releases a dangling partial tag at the end", () => expect(run(["use <th"])).toBe("use <th"));
  it("drops an unfinished thought", () => expect(run(["Hi <think>still going"])).toBe("Hi "));
  it("is case-insensitive and supports <thinking>", () => expect(stripThinking("<THINKING>x</THINKING>ok")).toBe("ok"));
  it("removes a stray closing tag", () => expect(stripThinking("reasoning</think>Final")).toBe("reasoningFinal"));
  it("gives reasoning models a bigger budget", () => {
    expect(isReasoningModel("qwen3:8b")).toBe(true);
    expect(isReasoningModel("qwen3-coder:30b")).toBe(false);
    expect(isReasoningModel("qwen2.5:7b")).toBe(false);
    expect(maxTokensFor("deepseek-r1:8b")).toBeGreaterThan(maxTokensFor("llama3.2"));
  });
});

describe("emoji shortcodes", () => {
  it("converts known codes", () => expect(replaceEmojiShortcodes("nice :fire: :tada:")).toBe("nice 🔥 🎉"));
  it("leaves unknown codes and clock times alone", () =>
    expect(replaceEmojiShortcodes("at 10:30:45 :nope:")).toBe("at 10:30:45 :nope:"));
  it("skips inline and fenced code", () => {
    expect(replaceEmojiShortcodes("`:fire:` and :fire:")).toBe("`:fire:` and 🔥");
    expect(replaceEmojiShortcodes("```\n:fire:\n```\n:fire:")).toBe("```\n:fire:\n```\n🔥");
  });
});

describe("prompt recall", () => {
  const history = promptHistory(["first", "second", "second", "third"]);
  it("dedupes and orders newest first", () => expect(history).toEqual(["third", "second", "first"]));
  it("walks back and forward, restoring the draft", () => {
    const up1 = recallStep(freshRecall, "ArrowUp", "", history)!;
    expect(up1.value).toBe("third");
    const up2 = recallStep(up1.state, "ArrowUp", up1.value, history)!;
    expect(up2.value).toBe("second");
    const down = recallStep(up2.state, "ArrowDown", up2.value, history)!;
    expect(down.value).toBe("third");
    const back = recallStep(down.state, "ArrowDown", down.value, history)!;
    expect(back.value).toBe("");
  });
  it("does not hijack a draft in progress", () => expect(recallStep(freshRecall, "ArrowUp", "typing…", history)).toBeNull());
  it("stops at the oldest entry", () => {
    let s = recallStep(freshRecall, "ArrowUp", "", history)!;
    for (let i = 0; i < 5; i++) s = recallStep(s.state, "ArrowUp", s.value, history)!;
    expect(s.value).toBe("first");
  });
});

describe("slash commands", () => {
  it("ignores normal text and file paths", () => {
    expect(parseSlash("hello")).toBeNull();
    expect(parseSlash("/etc/fstab is broken")).toBeNull();
  });
  it("parses controls", () => {
    expect(parseSlash("/mode solve")).toEqual({ ok: true, action: { type: "mode", mode: "solve" } });
    expect(parseSlash("/rounds 3")).toEqual({ ok: true, action: { type: "rounds", rounds: 3 } });
    expect(parseSlash("/theme final fantasy")).toEqual({ ok: true, action: { type: "theme", theme: "finalfantasy" } });
    expect(parseSlash("/assistant off")).toEqual({ ok: true, action: { type: "assistant", on: false } });
    expect(parseSlash("/CLEAR")).toEqual({ ok: true, action: { type: "clear" } });
  });
  it("explains bad input", () => {
    expect(parseSlash("/rounds 9")).toMatchObject({ ok: false });
    expect(parseSlash("/rounds")).toMatchObject({ ok: false });
    expect(parseSlash("/mode nope")).toMatchObject({ ok: false });
    expect(parseSlash("/wat")).toMatchObject({ ok: false });
  });
  it("suggests commands and arguments", () => {
    expect(slashSuggestions("/th").map((s) => s.insert)).toEqual(["/theme "]);
    expect(slashSuggestions("/mode so").map((s) => s.insert)).toEqual(["/mode solve"]);
    expect(slashSuggestions("hello")).toEqual([]);
    expect(slashSuggestions("/").length).toBeGreaterThan(5);
  });
  it("help lists every command", () => expect(helpText()).toContain("/confetti"));
});

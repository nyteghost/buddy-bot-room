import { describe, expect, it } from "vitest";
import { characterVoice, speakableText } from "../lib/cenobite-voices";

describe("character reply voices", () => {
  it("keeps Pinhead's cold delivery distinct from normal Nova", () => {
    expect(characterVoice("nova", "hellraiser").direction).toContain("cold, deep, regal");
    expect(characterVoice("nova", "normal").direction).toContain("Warm, curious");
  });
  it("reads silent horror characters as narration without inventing dialogue", () => {
    expect(characterVoice("byte", "horror").direction).toContain("Jason is silent");
    expect(characterVoice("sage", "horror").direction).toContain("Michael is mute");
  });
  it("does not truncate an ordinary long reply at the former 1200 character limit", () => {
    const text = "A thoughtful reply. ".repeat(100).trim();
    expect(speakableText(text)).toBe(text);
  });
});
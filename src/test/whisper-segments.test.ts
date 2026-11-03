import { it, expect } from "vitest";
import { timedWhisperText } from "@/lib/whisper-segments";
it("preserves returned segment estimates with real chunk offsets and millisecond precision", () => {
  expect(
    timedWhisperText(
      { text: "Hello", segments: [{ start: 1.25, end: 2.875, text: "Hello" }] },
      180,
      90,
    ),
  ).toBe("[00:03:01.250 - 00:03:02.875] Hello");
});
it("falls back to text rather than inventing times when timing is absent or invalid", () => {
  for (const segments of [
    undefined,
    [{ start: -1, end: 4, text: "Hello" }],
    [{ start: 0, end: 91, text: "Hello" }],
    [{ start: NaN, end: 4, text: "Hello" }],
  ])
    expect(timedWhisperText({ text: "Hello", segments }, 180, 90)).toBe("Hello");
});
it("rejects excessively large response text and never invents speaker identities", () => {
  expect(() => timedWhisperText({ text: "x".repeat(10001) }, 0, 180)).toThrow();
  expect(
    timedWhisperText(
      { text: "Hi", segments: [{ start: 0, end: 1, text: "Hi", speaker: "Made up person" }] },
      0,
      180,
    ),
  ).not.toContain("Made up person");
});

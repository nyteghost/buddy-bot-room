import { it, expect } from "vitest";
import { webMode, needsWeb, clockContext } from "@/lib/assistant-web";
it("searches public time-sensitive questions in Auto, including election questions", () => {
  for (const q of [
    "When are the midterms?",
    "Which side will be the midterms?",
    "Who is the current president?",
    "Weather forecast today",
    "Latest release news",
  ])
    expect(needsWeb(q, "auto")).toBe(true);
  expect(needsWeb("Explain binary search", "off")).toBe(false);
});
it("keeps personal/local questions out of automatic external search and supports explicit overrides", () => {
  for (const q of [
    "When is my appointment?",
    "Current status of localhost",
    "Latest notes for 10.200.1.30",
    "token=[hidden] current",
  ])
    expect(needsWeb(q, "auto")).toBe(false);
  expect(needsWeb("Explain loops", "on")).toBe(true);
  expect(needsWeb("Explain loops", "auto")).toBe(false);
});
it("preserves legacy opt-outs and supplies an actual validated current-time context", () => {
  expect(webMode(undefined, false)).toBe("off");
  expect(webMode(undefined)).toBe("auto");
  expect(clockContext("invalid-zone", new Date("2026-11-02T12:00:00Z")).zone).toBe("UTC");
  expect(clockContext("America/New_York", new Date("2026-11-02T12:00:00Z")).date).toContain(
    "November",
  );
});

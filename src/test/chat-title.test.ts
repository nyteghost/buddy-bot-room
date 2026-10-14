import { describe, it, expect } from "vitest";
import { chatTitle } from "@/lib/saved-discussions";
describe("auto-saved chat title", () => {
  it("uses the first thing the user typed", () => {
    expect(chatTitle([{ id: "1", role: "user", parts: [{ type: "text", text: "Plan my week" }] } as never])).toBe("Plan my week");
  });
  it("falls back for an empty chat", () => { expect(chatTitle([])).toBe("Untitled chat"); });
});

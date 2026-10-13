import { describe, expect, it } from "vitest";
import { modeCommand } from "@/lib/hellraiser";
describe("Hellraiser mode command", () => {
  it("activates on 'Hellraiser Mode'", () => expect(modeCommand("  Hellraiser Mode! ")).toBe("on"));
  it("deactivates on 'Normal mode'", () => expect(modeCommand("normal mode")).toBe("off"));
  it("ignores ordinary topics", () => expect(modeCommand("Hellraiser mode is cool")).toBeNull());
});

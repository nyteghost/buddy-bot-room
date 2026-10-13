import { describe, expect, it } from "vitest";
import { characterModeCommand } from "./hellraiser";
import { normalizeKind } from "./engine";
import { agentName } from "./agents";

describe("cyberpunk theme and auto engine", () => {
  it("chat command switches to cyberpunk and back", () => {
    expect(characterModeCommand("Cyberpunk Mode")).toBe("cyberpunk");
    expect(characterModeCommand("cyberpunk mode off")).toBe("normal");
  });
  it("cyberpunk pals use their netrunner names", () => {
    expect(agentName("byte", false, false, "cyberpunk")).toBe("Glitch");
  });
  it("auto engine choice survives saving", () => {
    expect(normalizeKind("auto")).toBe("auto");
  });
});

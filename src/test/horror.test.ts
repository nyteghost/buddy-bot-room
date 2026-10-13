import { describe, expect, it } from "vitest";
import { characterModeCommand, setCharacterMode, setHellraiser } from "@/lib/hellraiser";
import { agentPersona } from "@/lib/agents";

describe("Horror Mode", () => {
  it("activates with Horror Mode, case-insensitively", () => {
    expect(characterModeCommand("  Horror Mode! ")).toBe("horror");
  });
  it("deactivates with Horror Mode Off", () => {
    expect(characterModeCommand("Horror Mode OFF")).toBe("normal");
  });
  it("does not interpret an ordinary topic as a mode command", () => {
    expect(characterModeCommand("Discuss Horror Mode Off in movies")).toBeNull();
  });
  it("preserves Hellraiser activation and deactivation", () => {
    expect(characterModeCommand("Hellraiser Mode")).toBe("hellraiser");
    expect(characterModeCommand("Hellraiser Mode Off")).toBe("normal");
  });
  it("uses the requested horror icons and personalities", () => {
    expect(agentPersona("nova", false, true).name).toBe("Ghostface");
    expect(agentPersona("byte", false, true).name).toBe("Jason Voorhees");
    expect(agentPersona("sage", false, true).name).toBe("Michael Myers");
    expect(agentPersona("pip", false, true).name).toBe("Freddy Krueger");
    expect(agentPersona("nova", false, false).name).toBe("Nova");
  });
  it("switching modes clears the legacy Hellraiser flag", () => {
    setHellraiser(true);
    setCharacterMode("horror");
    expect(localStorage.getItem("pixel-pals-hellraiser-v1")).toBe("0");
    expect(localStorage.getItem("pixel-pals-character-mode-v1")).toBe("horror");
    setCharacterMode("normal");
    expect(localStorage.getItem("pixel-pals-character-mode-v1")).toBe("normal");
  });
});
import { describe, it, expect } from "vitest";
import { agents, agentPersona } from "@/lib/agents";
import { fantasyCast } from "@/lib/theme-personas";
import { characterSprite } from "@/lib/character-sprites";
import { setCharacterMode, characterModeCommand } from "@/lib/hellraiser";
describe("New character themes", () => {
  it("Final Fantasy uses seven main protagonists from seven different games", () => {
    expect(Object.values(fantasyCast).filter(c => c.name !== "Saiyan").map(c => [c.name, c.game])).toEqual([
      ["Cloud Strife", "VII"], ["Squall Leonhart", "VIII"], ["Zidane Tribal", "IX"], ["Tidus", "X"], ["Terra Branford", "VI"], ["Lightning", "XIII"], ["Clive Rosfield", "XVI"],
    ]);
    expect(new Set(Object.values(fantasyCast).filter(c => c.name !== "Saiyan").map(c => c.game)).size).toBe(7);
  });
  it("Matrix identities override other modes without conflict", () => {
    expect(agentPersona("nova", true, true, "matrix").name).toBe("Neo");
    expect(agentPersona("claude", false, false, "matrix").name).toBe("The Architect");
    setCharacterMode("matrix"); expect(localStorage.getItem("pixel-pals-character-mode-v1")).toBe("matrix");
    expect(localStorage.getItem("pixel-pals-hellraiser-v1")).toBe("0");
    setCharacterMode("normal");
  });
  it("new themes have distinct native 32 by 32 sprites for all seven agents", () => {
    for(const mode of ["matrix", "finalfantasy"] as const) {
      const sprites = agents.filter(a => a.id !== "saiyan").map(a => characterSprite(a.id, mode)); // Saiyan has its own directional art
      expect(new Set(sprites.map(s => s.join(""))).size).toBe(7);
      for(const sprite of sprites) { expect(sprite.length).toBe(32); expect(sprite.every(row => row.length === 32)).toBe(true); }
    }
  });
  it("theme commands select the new themes", () => {
    expect(characterModeCommand("Matrix Mode")).toBe("matrix");
    expect(characterModeCommand("Final Fantasy Theme")).toBe("finalfantasy");
  });
});
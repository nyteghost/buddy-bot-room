import { describe, expect, it } from "vitest";
import { agents, agentPersona, resolveMention } from "@/lib/agents";
import { MIMIC_TONE } from "@/lib/mimic-persona";
import { mimicChestSprite, characterSprite } from "@/lib/character-sprites";
import { cleanOverrides, mayUseRealData, memoryAccess } from "@/lib/character-overrides";
import { characterVoice } from "@/lib/cenobite-voices";
import { officeStations } from "@/lib/office-motion";
import { palActivity } from "@/lib/pal-room-life";

describe("Mimic is a distinct consent-scoped Pixel Pal", () => {
  it("registers a ninth Pal without renaming or removing the eight existing ones", () => {
    expect(agents.map(a => a.id)).toEqual(["nova","byte","sage","pip","echo","rune","claude","saiyan","mimic"]);
    expect(agents.find(a => a.id === "mimic")?.name).toBe("Mimic");
    expect(resolveMention("@mimic", "normal")).toBe("mimic");
    expect(resolveMention("@mimic", "linux")).toBe("mimic");
  });
  it("retains a recognizable helpful voice in every theme, without impersonating the human", () => {
    const normal = agentPersona("mimic", false, false, "normal", false, {});
    for (const mode of ["horror", "hellraiser", "linux", "assistant", "devteam", "dcc", "cyberpunk", "finalfantasy", "matrix"] as const) {
      expect(agentPersona("mimic", false, false, mode, true, {}).name).toBe("Mimic");
      expect(agentPersona("mimic", false, false, mode, true, {}).tone).toContain("You are not the human");
    }
    expect(normal.tone).toBe(MIMIC_TONE);
    expect(normal.tone).toContain("Never claim you executed");
    expect(normal.tone).toContain(">_>");
    expect(characterVoice("mimic", "normal").direction).toContain("never pretending to be the owner");
  });
  it("disables all sensitive live data by default and keeps Mimic's memories scoped", () => {
    expect(memoryAccess({}, "mimic")).toBe("own");
    expect(mayUseRealData({}, "mimic")).toBe(false);
    expect(memoryAccess({}, "nova")).toBe("all");
    expect(mayUseRealData({}, "nova")).toBe(true);
    const granted=cleanOverrides({mimic:{memory:"all",realData:true}},agents.map(a=>a.id));
    expect(granted["mimic"]).toEqual({memory:"all",realData:true});
    expect(memoryAccess(granted,"mimic")).toBe("all");
    expect(mayUseRealData(granted,"mimic")).toBe(true);
  });
  it("renders Mimic as a chest monster in every theme without relying on artwork files", () => {
    const art=mimicChestSprite();
    expect(art).toHaveLength(32);
    expect(art.every(row=>row.length===32)).toBe(true);
    expect(art.join("")).toContain("w");
    expect(art.join("")).toContain("r");
    expect(art.join("")).toContain("q");
    expect(characterSprite("mimic","normal")).toEqual(art);
    expect(characterSprite("mimic","devteam")).toEqual(art);
    expect(officeStations["mimic"].label).toBe("Mimic");
    expect(palActivity("mimic",0).text).toContain("Rummaging");
  });
});

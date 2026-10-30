import { describe, expect, it } from "vitest";
import { ALL_MODES } from "@/lib/agents";
import { defaultOpenModes, modeHelp, modeLabel, modePlaceholder, modeSuggestions, perMode } from "@/lib/mode-meta";

describe("per-mode tables", () => {
  it("have an entry for every mode, so a new mode cannot be half added", () => {
    for (const m of ALL_MODES) {
      expect(modeLabel[m]).toBeTruthy();
      expect(modeHelp[m]).toBeTruthy();
      expect(modePlaceholder[m]).toBeTruthy();
      expect(modeSuggestions[m].length).toBeGreaterThan(0);
      expect(typeof defaultOpenModes[m]).toBe("boolean");
    }
  });
  it("opens only My Pals Smart chat by default", () => {
    expect(ALL_MODES.filter((m) => defaultOpenModes[m])).toEqual(["smart"]);
  });
  it("perMode builds one independent value per mode", () => {
    const t = perMode(() => [] as number[]);
    t.smart.push(1);
    expect(Object.keys(t)).toEqual([...ALL_MODES]);
    expect(t.roundtable).toEqual([]);
    expect(perMode((m) => m === "debate").debate).toBe(true);
  });
});

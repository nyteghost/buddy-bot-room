import { describe, expect, it } from "vitest";
import { headingOf, officePose, officeStations } from "@/lib/office-motion";
import type { AgentId } from "@/lib/agents";

describe("shared assistant station wandering", () => {
  it("pauses at a desk then walks to another station", () => {
    expect(officePose("nova", 0, 0).walking).toBe(false);
    const moving = officePose("nova", 0, 7700);
    expect(moving.walking).toBe(true);
    expect(moving.y).toBeGreaterThan(officeStations.nova.home[1]);
    expect(officePose("nova", 0, 14500).walking).toBe(false);
  });
  it("keeps every route inside the office and returns home", () => {
    for (const id of Object.keys(officeStations) as AgentId[]) {
      for (let elapsed = 0; elapsed < 31000; elapsed += 250) {
        const pose = officePose(id, 0, elapsed);
        expect(pose.x).toBeGreaterThanOrEqual(12);
        expect(pose.x).toBeLessThanOrEqual(90);
        expect(pose.y).toBeGreaterThanOrEqual(28);
        expect(pose.y).toBeLessThanOrEqual(62);
      }
      expect(officePose(id, 0, 30200).x).toBe(officeStations[id].home[0]);
    }
  });
  it("keeps back-row and front-row name tags on separate lines", () => {
    // A tag sits just above its pal's head, so the two rows only stay readable if the
    // lowest back-row tag never reaches the highest front-row tag.
    const back = Object.keys(officeStations).filter((id) => officeStations[id as AgentId].facing === "away") as AgentId[];
    const front = Object.keys(officeStations).filter((id) => officeStations[id as AgentId].facing === "toward") as AgentId[];
    for (let elapsed = 0; elapsed < 31000; elapsed += 250) {
      const lowestBack = Math.max(...back.map((id) => officePose(id, 0, elapsed).y - 10.5));
      const highestFront = Math.min(...front.map((id) => officePose(id, 0, elapsed).y - 16.7));
      expect(lowestBack).toBeLessThan(highestFront);
    }
  });
  it("maps moves onto eight compass headings", () => {
    expect(headingOf(1, 0)).toBe("e");
    expect(headingOf(1, 1)).toBe("se");
    expect(headingOf(0, 1)).toBe("s");
    expect(headingOf(-1, 1)).toBe("sw");
    expect(headingOf(-1, 0)).toBe("w");
    expect(headingOf(-1, -1)).toBe("nw");
    expect(headingOf(0, -1)).toBe("n");
    expect(headingOf(1, -1)).toBe("ne");
  });
  it("walks at least one diagonal leg from every desk", () => {
    for (const id of Object.keys(officeStations) as AgentId[]) {
      const seen = new Set<string>();
      for (let elapsed = 0; elapsed < 31000; elapsed += 100) {
        const pose = officePose(id, 0, elapsed);
        if (pose.walking) seen.add(pose.heading);
      }
      expect([...seen].some((h) => h.length === 2)).toBe(true);
    }
  });
});

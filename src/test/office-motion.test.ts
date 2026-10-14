import { describe, expect, it } from "vitest";
import { officePose, officeStations } from "@/lib/office-motion";
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
        expect(pose.x).toBeLessThanOrEqual(87);
        expect(pose.y).toBeGreaterThanOrEqual(36);
        expect(pose.y).toBeLessThanOrEqual(90);
      }
      expect(officePose(id, 0, 30200).x).toBe(officeStations[id].home[0]);
    }
  });
});
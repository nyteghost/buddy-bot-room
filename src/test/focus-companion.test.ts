import { describe, expect, it } from "vitest";
import { COMPANION_MODES, companionActivity, FOCUS_CHECKPOINT_KEY, makeFocusSession, readFocusCheckpoint } from "@/lib/focus-companion";

describe("Focus Companion checkpoint rules", () => {
  const valid = makeFocusSession(" Review tomorrow's schedule ", " Open the schedule ", "byte", "quiet");

  it("starts with one task, a valid step and quiet company", () => {
    expect(valid).toEqual({ task: "Review tomorrow's schedule", step: "Open the schedule", pal: "byte", mode: "quiet", completed: [] });
    expect(makeFocusSession("", "Open file", "byte", "quiet")).toBeNull();
    expect(COMPANION_MODES).toEqual(["quiet", "checkins", "steps"]);
    expect(FOCUS_CHECKPOINT_KEY).toMatch(/focus-checkpoint/);
  });

  it("restores only an explicitly saved, validated checkpoint", () => {
    const input = { ...valid, completed: ["Open ShowPilot", "Look at the first event"] };
    expect(readFocusCheckpoint(JSON.stringify(input))).toEqual(input);
    expect(readFocusCheckpoint(null)).toBeNull();
    expect(readFocusCheckpoint('{"task":"x","step":"y","pal":"fake","mode":"quiet"}')).toBeNull();
    expect(readFocusCheckpoint('{"task":"x","step":"y","pal":"byte","mode":"surveil"}')).toBeNull();
    expect(readFocusCheckpoint("x".repeat(4100))).toBeNull();
    expect(readFocusCheckpoint("{oops")).toBeNull();
    expect(readFocusCheckpoint(JSON.stringify({ ...input, completed: Array(50).fill("Step") }))?.completed.length).toBe(8);
  });

  it("illustrates parallel activities without claiming external-app access", () => {
    expect(companionActivity("Review the show schedule")).toMatch(/sample plan/);
    expect(companionActivity("Email Brian")).toMatch(/sample message/);
    expect(companionActivity("Sweep the floor")).toMatch(/quietly/);
  });
});

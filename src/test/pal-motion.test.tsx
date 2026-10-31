import { render } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { ambientMotion, advanceMotionClock, easeWalk, motionProfile } from "@/lib/pal-motion";
import { PalArtRig } from "@/components/pal-art-rig";

describe("Pal animation continuity", () => {
  it("keeps waypoint endpoints and eases into and out of each leg", () => {
    expect(easeWalk(0)).toBe(0); expect(easeWalk(1)).toBe(1);
    expect(easeWalk(.01)).toBeLessThan(.01);
    expect(easeWalk(.99)).toBeGreaterThan(.99);
    expect(easeWalk(NaN)).toBe(0);
    expect(easeWalk(-1)).toBe(0); expect(easeWalk(2)).toBe(1);
  });
  it("resumes a paused route without teleporting through the hidden time", () => {
    expect(advanceMotionClock(7700, 60_000)).toBe(7950);
    expect(advanceMotionClock(7700, -100)).toBe(7700);
    expect(advanceMotionClock(7700, 100)).toBe(7800);
  });
  it("gives pals distinct predictable pacing and varied ambient poses", () => {
    expect(motionProfile("pip").gaitMs).toBeLessThan(motionProfile("sage").gaitMs);
    expect(motionProfile("echo")).toEqual(motionProfile("echo"));
    const poses = new Set(Array.from({ length: 8 }, (_, phase) => ambientMotion("nova", phase)));
    expect(poses).toContain("look"); expect(poses).toContain("stretch");
    expect(ambientMotion("nova", NaN)).toBe(ambientMotion("nova", 0));
  });
  it("uses unique clip IDs for duplicate pals and keeps their accessible identity", () => {
    const view = render(<><PalArtRig id="nova" art="/test.png" motion="walk" className="pixel-character" /><PalArtRig id="nova" art="/test.png" motion="work" className="pixel-character" /></>);
    expect(view.getAllByRole("img", { name: "nova pixel character" })).toHaveLength(2);
    const ids = Array.from(view.container.querySelectorAll("clipPath")).map(node => node.id);
    expect(new Set(ids).size).toBe(ids.length);
    for (const node of view.container.querySelectorAll("[clip-path]")) {
      expect(ids).toContain(node.getAttribute("clip-path")!.slice(5, -1));
    }
    view.unmount();
  });
});

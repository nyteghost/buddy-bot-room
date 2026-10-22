import { describe, it, expect } from "vitest";
import { crewCheck } from "@/lib/stage-crew-sheet";

describe("crew sheet check column", () => {
  it("flags short, uncounted and ok parts", () => {
    expect(crewCheck({ label: "8 ft rails", need: 12, have: 10 })).toBe("SHORT 2");
    expect(crewCheck({ label: "8 ft rails", need: 4, have: null })).toBe("COUNT IT");
    expect(crewCheck({ label: "8 ft rails", need: 4, have: 4 })).toBe("ok");
  });
});

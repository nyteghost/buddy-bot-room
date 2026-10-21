import { describe, expect, it } from "vitest";
import { addParts, checkParts, fillRun, NO_PARTS, parseHave, rampRunFt, stageParts } from "@/lib/stage-extras";

describe("stage extras", () => {
  it("fills runs with 8 ft first, 4 ft for a short leftover", () => {
    expect(fillRun(16)).toEqual({ eight: 2, four: 0 });
    expect(fillRun(12)).toEqual({ eight: 1, four: 1 });
    expect(fillRun(20)).toEqual({ eight: 2, four: 1 });
    expect(fillRun(14)).toEqual({ eight: 2, four: 0 });
    expect(fillRun(0)).toEqual({ eight: 0, four: 0 });
    expect(fillRun(-3)).toEqual({ eight: 0, four: 0 });
  });
  it("takes stair and ramp openings out of the front rail", () => {
    const e = { rails: "front" as const, skirts: "none" as const, ramps: 0 };
    expect(stageParts(e, 24, 16, 0)).toMatchObject({ rail8: 3, rail4: 0 });
    expect(stageParts(e, 24, 16, 1)).toMatchObject({ rail8: 2, rail4: 1 }); // 20 ft
    expect(stageParts({ ...e, ramps: 1 }, 24, 16, 1)).toMatchObject({ rail8: 2, rail4: 0, ramp: 1 }); // 16 ft
  });
  it("counts skirts per side and multiplies by stage quantity", () => {
    const e = { rails: "none" as const, skirts: "all" as const, ramps: 0 };
    expect(stageParts(e, 24, 16, 0).skirt8).toBe(3 + 3 + 2 + 2);
    expect(stageParts(e, 4, 8, 0, 3).skirt8).toBe(3 * (1 + 1 + 1 + 1));
  });
  it("ramp run in feet equals rise in inches", () => {
    expect(rampRunFt(32)).toBe(32);
  });
  it("flags shortages but not uncounted stock", () => {
    const need = addParts(NO_PARTS, { rail8: 4, rail4: 2, skirt8: 0, ramp: 2 });
    const lines = checkParts(need, { rail8: 3, rail4: null, skirt8: null, ramp: 1 });
    const get = (k: string) => lines.find((l) => l.key === k);
    expect(get("rail8")).toMatchObject({ status: "short", short: 1 });
    expect(get("rail4")?.status).toBe("unknown");
    expect(get("skirt8")?.status).toBe("unused");
    expect(get("ramp")).toMatchObject({ status: "short", short: 1 });
  });
  it("parses the have boxes", () => {
    expect(parseHave("")).toBe(null);
    expect(parseHave(" 12 ")).toBe(12);
    expect(parseHave("-2")).toBe(null);
  });
});

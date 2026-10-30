import { describe, expect, it } from "vitest";
import { nextMondayIso } from "@/lib/work-tools";

describe("Excel paste date-picker default", () => {
  it("defaults Friday October 30, 2026 to Monday November 2", () => {
    expect(nextMondayIso(new Date(2026, 9, 30, 23, 30))).toBe("2026-11-02");
  });
  it("selects the following week if today is Monday", () => {
    expect(nextMondayIso(new Date(2026, 10, 2, 9))).toBe("2026-11-09");
  });
  it("selects tomorrow when today is Sunday", () => {
    expect(nextMondayIso(new Date(2026, 10, 1, 8))).toBe("2026-11-02");
  });
  it("works across a year change without UTC shifting the local date", () => {
    expect(nextMondayIso(new Date(2026, 11, 31, 23, 59))).toBe("2027-01-04");
  });
});

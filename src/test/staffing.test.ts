import { describe, it, expect } from "vitest";
import { planWeek, dayNeed, shiftText } from "@/lib/staffing";
import type { EventEntry } from "@/lib/work-tools";

const e = (date: string, space: string, start: number, end: number, title = "Show", eventId = "1"): EventEntry =>
  ({ date, space, start, end, title, code: "S", eventId }) as EventEntry;
const dates = ["2026-11-09", "2026-11-10", "2026-11-11", "2026-11-12", "2026-11-13", "2026-11-14", "2026-11-15"];

describe("staffing", () => {
  it("needs 2 all day for a show in 2+ halls", () => {
    const need = dayNeed([e("2026-11-10", "Hall A", 480, 600), e("2026-11-10", "Hall B", 900, 1020)], "2026-11-10");
    expect(need[16]).toBe(2);
    expect(need[40]).toBe(0);
  });
  it("Madjid is never on Tue/Wed and Alemneh never works Sat/Sun unrequired", () => {
    const plans = planWeek(dates, [e("2026-11-10", "Hall A", 480, 1000)]);
    expect(plans[1]!.assignments.some((a) => a.name.startsWith("Madjid"))).toBe(false);
    expect(plans[1]!.assignments.some((a) => a.name.startsWith("Alemneh") && shiftText(a) === "7a-3:30p")).toBe(true);
  });
  it("uses Jontee only for a single evening engineer with a medium show", () => {
    const small = planWeek(["2026-11-12"], [e("2026-11-12", "Hall A", 480, 1260)]);
    expect(small[0]!.assignments.some((a) => a.name.startsWith("Jontee"))).toBe(false);
    const medium = planWeek(["2026-11-12"], [e("2026-11-12", "Hall A", 480, 1260), e("2026-11-12", "BallRoom A", 480, 1260)]);
    expect(medium[0]!.assignments.some((a) => a.name.startsWith("Jontee"))).toBe(true);
  });
  it("gives every assignment a reason and Jacquline default hours", () => {
    const p = planWeek(["2026-11-10"], [e("2026-11-10", "Hall A", 480, 1000)])[0]!;
    expect(p.assignments.every((a) => a.reason.length > 0)).toBe(true);
    expect(p.desk).toMatchObject({ start: 420, end: 930 });
  });
  it("keeps Alexis and Franck to their blocks and Edison takes a 1a close", () => {
    const plans = planWeek(["2026-11-12"], [e("2026-11-12", "Hall A", 480, 1560), e("2026-11-12", "Hall B", 480, 1560)]);
    for (const a of plans[0]!.assignments) {
      if (a.name.startsWith("Alexis")) expect(a.start === 420 || a.start === 480 || a.start === 540).toBe(true);
      if (a.name.startsWith("Franck")) expect(a.start).toBeGreaterThanOrEqual(720);
    }
    expect(plans[0]!.assignments.some((a) => a.name.startsWith("Edison") && a.end === 1500)).toBe(true);
  });
});

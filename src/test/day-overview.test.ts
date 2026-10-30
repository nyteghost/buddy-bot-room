import { describe, expect, it } from "vitest";
import { eventsOnDay, offsetDateKey, zoneDateKey } from "@/lib/day-overview";

describe("Today window next-day overview", () => {
  it("moves calendar days correctly over month-end, year-end and DST", () => {
    expect(offsetDateKey("2026-10-30", 1)).toBe("2026-10-31");
    expect(offsetDateKey("2026-10-31", 2)).toBe("2026-11-02");
    expect(offsetDateKey("2026-12-31", 1)).toBe("2027-01-01");
    expect(zoneDateKey(Date.parse("2026-11-01T04:30:00Z"), "America/Chicago")).toBe("2026-10-31");
    expect(zoneDateKey(Date.parse("2026-11-01T06:30:00Z"), "America/Chicago")).toBe("2026-11-01");
  });
  it("includes multi-day appointments and excludes events ending at the start of the day", () => {
    const z = "America/Chicago";
    const events = [
      { title: "Overnight", start: Date.parse("2026-10-31T23:00:00Z"), end: Date.parse("2026-11-01T15:00:00Z"), allDay: false },
      { title: "Ends at midnight", start: Date.parse("2026-10-30T19:00:00Z"), end: Date.parse("2026-10-31T05:00:00Z"), allDay: false },
    ];
    expect(eventsOnDay(events, "2026-10-31", z, Date.parse("2026-10-30T12:00:00Z")).map((x) => x.title)).toEqual(["Overnight"]);
  });
});

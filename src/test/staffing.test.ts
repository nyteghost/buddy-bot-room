import { describe, it, expect } from "vitest";
import { airwallMinutes, planWeek, planWeeks, dayNeed, shiftText, workedHours, SHOW_STAFF, WEEK_HOURS } from "@/lib/staffing";
import type { EventEntry } from "@/lib/work-tools";

const e = (date: string, space: string, start: number, end: number, title = "Show", eventId = "1"): EventEntry =>
  ({ date, space, start, end, title, code: "S", eventId }) as EventEntry;
const dates = ["2026-11-09", "2026-11-10", "2026-11-11", "2026-11-12", "2026-11-13", "2026-11-14", "2026-11-15"];

describe("staffing", () => {
  it("treats a zero-length marker (7:30a move-in) as a point, not an all-day run", () => {
    const need = dayNeed([e("2026-11-10", "Hall A", 450, 450), e("2026-11-10", "Hall A", 585, 780)], "2026-11-10");
    expect(need[40]).toBe(0); // 8p: nothing needed
    expect(need[2 * 11]).toBe(1); // 11a: the show
  });
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
  it("never schedules Jontee, only suggests him", () => {
    const big = [e("2026-11-12", "Hall A", 480, 1380), e("2026-11-12", "Hall B", 480, 1380)];
    const p = planWeek(["2026-11-12"], big, undefined, { "Edison Dunkley": { "2026-11-12": { off: true } }, "Franck Pierre-Louis": { "2026-11-12": { off: true } } })[0]!;
    expect(p.assignments.some((a) => a.name.startsWith("Jontee"))).toBe(false);
  });
  it("holds 2 people for air wall work", () => {
    const p = planWeek(["2026-11-12"], [e("2026-11-12", "Hall A", 480, 600)], undefined, {}, undefined, [{ date: "2026-11-12", start: 1020, end: 1080, n: 2, text: "Make Hall AB" }])[0]!;
    expect(p.need[34]).toBe(2);
  });
  it("gives every assignment a reason and Jacquline default hours", () => {
    const p = planWeek(["2026-11-10"], [e("2026-11-10", "Hall A", 480, 1000)])[0]!;
    expect(p.assignments.every((a) => a.reason.length > 0)).toBe(true);
    expect(p.desk).toMatchObject({ start: 420, end: 930 });
  });
  it("keeps Alexis and Franck to their blocks and Edison takes a 1a close", () => {
    const plans = planWeek(["2026-11-12"], [e("2026-11-12", "Hall A", 480, 1500), e("2026-11-12", "Hall B", 480, 1500)]);
    for (const a of plans[0]!.assignments) {
      if (a.name.startsWith("Alexis")) expect(a.start === 420 || a.start === 480 || a.start === 540).toBe(true);
      if (a.name.startsWith("Franck")) expect(a.start).toBeGreaterThanOrEqual(720);
    }
    expect(plans[0]!.assignments.some((a) => a.name.startsWith("Edison") && a.end === 1500)).toBe(true);
  });
  it("puts Madjid on Tuesday for a power-heavy show", () => {
    const p = planWeek(["2026-11-10"], [e("2026-11-10", "Hall A", 480, 1000, "Gordon Food Service Show")])[0]!;
    expect(p.assignments.some((a) => a.name.startsWith("Madjid"))).toBe(true);
  });
  it("plans whole weeks and fills the days nobody works with OFF-able people", () => {
    const plans = planWeeks(["2026-11-10"], [e("2026-11-10", "Hall A", 480, 1000)]);
    expect(plans).toHaveLength(7);
    expect(plans[0]!.date).toBe("2026-11-09");
  });
  it("sizes air wall jobs: ballroom 20-90 min, a hall wall at least 90", () => {
    expect(airwallMinutes("BALLROOM", "Make ABE")).toBe(40);
    expect(airwallMinutes("BALLROOM", "Make full ballroom")).toBe(90);
    expect(airwallMinutes("HALLS", "Make Hall AB")).toBe(90);
  });

  const weekHours = (plans: ReturnType<typeof planWeeks>, name: string, avail: Record<string, Record<string, { off: boolean }>> = {}) =>
    plans.reduce((t, p) => t + (p.assignments.filter((a) => a.name === name).reduce((x, a) => x + workedHours(a), 0)) + (avail[name]?.[p.date]?.off ? 8 : 0), 0);
  it("gives everyone 40 hours in a week with no shows at all", () => {
    const plans = planWeeks(dates, []);
    for (const s of SHOW_STAFF) expect(weekHours(plans, s.name)).toBe(WEEK_HOURS);
    const desk = plans.reduce((t, p) => t + (p.desk ? workedHours(p.desk) : 0), 0);
    expect(desk).toBe(WEEK_HOURS);
  });
  it("keeps two days off in a row and Madjid off Tue/Wed when topping up", () => {
    const plans = planWeeks(dates, [e("2026-11-10", "Hall A", 480, 1000)]);
    for (const s of SHOW_STAFF) {
      const on = plans.map((p) => p.assignments.some((a) => a.name === s.name));
      expect(on.some((x, i) => !x && !on[(i + 1) % 7])).toBe(true);
    }
    expect(plans[1]!.assignments.some((a) => a.name.startsWith("Madjid"))).toBe(false);
    expect(plans[2]!.assignments.some((a) => a.name.startsWith("Madjid"))).toBe(false);
  });
  it("counts holidays and PTO as 8 hours toward the 40", () => {
    const avail = { "Alexis Albert": { "2026-11-09": { off: true }, "2026-11-10": { off: true } } };
    const plans = planWeeks(dates, [], avail);
    expect(weekHours(plans, "Alexis Albert", avail)).toBe(WEEK_HOURS);
    expect(plans[0]!.assignments.some((a) => a.name.startsWith("Alexis"))).toBe(false);
  });
  it("tops up Edison without using his usual Mon/Tue off days when other days work", () => {
    const plans = planWeeks(dates, []);
    expect(plans[0]!.assignments.some((a) => a.name.startsWith("Edison"))).toBe(false);
    expect(plans[1]!.assignments.some((a) => a.name.startsWith("Edison"))).toBe(false);
  });

  it("keeps Jacquline to 5 days and off weekends unless the Service Desk is open, and still gives her 40", () => {
    const desk = { ...e("2026-11-14", "Hall A", 480, 700, "Show", "2"), code: "Exmi" } as EventEntry; // Saturday desk day
    const plans = planWeeks(dates, [desk]);
    const days = plans.filter((p) => p.desk).map((p) => p.date);
    expect(days.length).toBe(5);
    expect(days).toContain("2026-11-14");
    expect(days).not.toContain("2026-11-15");
    expect(plans.reduce((t, p) => t + (p.desk ? workedHours(p.desk) : 0), 0)).toBe(WEEK_HOURS);
  });
  it("keeps Madjid to 5 days even when a power-heavy show brings him in on Tuesday", () => {
    const plans = planWeeks(dates, [e("2026-11-10", "Hall A", 480, 1000, "Gordon Food Service Show")]);
    expect(plans[1]!.assignments.some((a) => a.name.startsWith("Madjid"))).toBe(true);
    expect(plans.filter((p) => p.assignments.some((a) => a.name.startsWith("Madjid"))).length).toBe(5);
    expect(weekHours(plans, "Madjid Lakhdari")).toBe(WEEK_HOURS);
  });
  it("never has anyone past 5 days across ordinary weeks", () => {
    const plans = planWeeks(dates, [e("2026-11-10", "Hall A", 480, 1000), e("2026-11-10", "Hall B", 480, 1000), e("2026-11-14", "Hall A", 480, 1300)]);
    for (const s of SHOW_STAFF) expect(plans.filter((p) => p.assignments.some((a) => a.name === s.name)).length <= 5).toBe(true);
  });

  it("never leaves Franck as the only engineer during a show", () => {
    const shows = [e("2026-11-10", "Hall A", 480, 1000), e("2026-11-12", "Hall A", 480, 1300), e("2026-11-14", "Hall A", 480, 1380), e("2026-11-14", "Hall B", 480, 1380)];
    const plans = planWeeks(dates, shows);
    for (const p of plans) for (let i = 0; i < 56; i++) {
      if (!p.need[i]) continue;
      const on = p.assignments.filter((a) => a.start < (i + 1) * 30 && a.end > i * 30);
      if (on.some((a) => a.name.startsWith("Franck"))) expect(on.length >= 2).toBe(true);
    }
  });
  it("Franck still counts as the second person when someone else is on", () => {
    const p = planWeek(["2026-11-14"], [e("2026-11-14", "Hall A", 480, 1260), e("2026-11-14", "Hall B", 480, 1260)])[0]!;
    expect(p.assignments.some((a) => a.name.startsWith("Franck"))).toBe(true);
  });
});

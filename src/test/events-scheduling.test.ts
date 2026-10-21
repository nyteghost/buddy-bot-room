import { describe, expect, it } from "vitest";
import { classifyByDescription, classifyEvent, summarizeEvents, taskSuggestions, type EventRow } from "@/lib/work-tools";

const row = (o: Partial<EventRow>): EventRow => ({ level: 2, usage: "", start: "08:00 AM", end: "05:00 PM", description: "", space: "Exhibit Hall A (EXA)", date: "2026-10-06", event: "Home Depot", ...o });

describe("For Scheduling report (no Usage column)", () => {
  it.each([
    ["Move In", "MI"], ["AV Move In", "MI"], ["Decorator Move In", "MI"], ["Exhibitor Move In", "Exmi"],
    ["Move In - Exhibitors", "Exmi"], ["Exhibitor Service Desk", "Exmi"], ["Engineering Service Desk", "Exmi"],
    ["Move Out", "MO"], ["Exhibitor Move Out", "MO"], ["Load Out", "MO"], ["Reception", "Food"], ["Plated Dinner", "Food"],
    ["Meeting", "MTG"], ["General Session", "S"], ["Breakout Session", "S"], ["ARA SHOW OPEN", "S"],
  ])("%s is %s", (d, c) => expect(classifyByDescription(d)).toBe(c));
  it.each(["Event Inspection Walk-Through", "Break", "Client Arrival", "Show Office", "Room Turn", "Exhibitor Early Access"])("%s is skipped", (d) => expect(classifyByDescription(d)).toBe(null));
  it("uses the description when Usage is blank, and still uses Usage when present", () => {
    expect(classifyEvent(row({ description: "Move In" }))).toBe("MI");
    expect(classifyEvent(row({ usage: "Move Out (OUT)", description: "Whatever" }))).toBe("MO");
  });
  it("a reception after the show gets its own Food line; one inside the show does not", () => {
    const after = summarizeEvents([row({ description: "General Session", start: "09:00 AM", end: "03:00 PM" }), row({ description: "Reception", start: "04:00 PM", end: "06:00 PM" })]);
    expect(after.map((e) => e.code)).toEqual(["S", "Food"]);
    const inside = summarizeEvents([row({ description: "General Session", start: "09:00 AM", end: "05:00 PM" }), row({ description: "Buffet Lunch", start: "12:00 PM", end: "01:00 PM" })]);
    expect(inside.map((e) => e.code)).toEqual(["S"]);
  });
  it("a lone meeting is MTG; a meeting inside a show is absorbed", () => {
    expect(summarizeEvents([row({ description: "Meeting", space: "Ballroom E (BRE)" })]).map((e) => e.code)).toEqual(["MTG"]);
  });
  it("suggests tasks for stage work and room turns", () => {
    const t = taskSuggestions([
      row({ description: "Set Stage", space: "Chattahoochee Ballroom (BRFULL)", start: "11:00 AM" }),
      row({ description: "Room Turn", space: "Ballroom F (BRF)", start: "01:00 PM" }),
      row({ description: "General Session" }),
    ]);
    expect(t.length).toBe(2);
    expect(t.every((x) => x.section === "BALLROOM")).toBe(true);
    expect(t.some((x) => x.text.startsWith("Stage: Set Stage"))).toBe(true);
    expect(t.some((x) => x.text.startsWith("Room Turn (BR F"))).toBe(true);
  });
});

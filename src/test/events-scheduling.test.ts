import { describe, expect, it } from "vitest";
import { isCancelledRow, isPendingRow, entryLabel, airwallTasks, sharedSpaces, classifyByDescription, classifyEvent, summarizeEvents, taskSuggestions, type EventRow } from "@/lib/work-tools";

const row = (o: Partial<EventRow>): EventRow => ({ level: 2, usage: "", start: "08:00 AM", end: "05:00 PM", description: "", space: "Exhibit Hall A (EXA)", date: "2026-10-06", event: "Home Depot", ...o });

describe("For Scheduling report (no Usage column)", () => {
  it.each([
    ["Move In", "MI"], ["AV Move In", "MI"], ["Decorator Move In", "MI"], ["Exhibitor Move In", "Exmi"],
    ["Move In - Exhibitors", "Exmi"], ["Exhibitor Service Desk", "Exmi"], ["Engineering Service Desk", "Exmi"],
    ["Move Out", "MO"], ["Client Arrival", "Arr"], ["Exhibitor Move Out", "MO"], ["Load Out", "MO"], ["Reception", "Food"], ["Plated Dinner", "Dinner"], ["Buffet Breakfast", "Breakfast"], ["Plated Lunch/Entree Served", "Lunch"],
    ["Registration/Vendor Load-In", "S"], ["Registration - Exhibitors Only", "S"], ["Meeting", "MTG"], ["General Session", "S"], ["Breakout Session", "S"], ["ARA SHOW OPEN", "S"],
  ])("%s is %s", (d, c) => expect(classifyByDescription(d)).toBe(c));
  it.each(["Event Inspection Walk-Through", "Break", "Show Office", "Room Turn", "Exhibitor Early Access"])("%s is skipped", (d) => expect(classifyByDescription(d)).toBe(null));
  it("uses the description when Usage is blank, and still uses Usage when present", () => {
    expect(classifyEvent(row({ description: "Move In" }))).toBe("MI");
    expect(classifyEvent(row({ usage: "Move Out (OUT)", description: "Whatever" }))).toBe("MO");
  });
  it("breakfast, lunch and dinner keep their own line, even inside a show; a reception does not", () => {
    const meals = summarizeEvents([row({ description: "General Session", start: "08:00 AM", end: "05:00 PM" }), row({ description: "Plated Breakfast", start: "08:00 AM", end: "09:00 AM" }), row({ description: "Buffet Lunch", start: "12:00 PM", end: "01:00 PM" }), row({ description: "Plated Dinner", start: "06:00 PM", end: "08:00 PM" }), row({ description: "Hosted Bar", start: "05:00 PM", end: "06:00 PM" })]);
    expect(meals.map((e) => e.code)).toEqual(["Breakfast", "S", "Lunch", "Dinner"]);
  });
  it("a reception after the show gets no line of its own, and neither does one inside it", () => {
    const after = summarizeEvents([row({ description: "General Session", start: "09:00 AM", end: "03:00 PM" }), row({ description: "Reception", start: "04:00 PM", end: "06:00 PM" })]);
    expect(after.map((e) => e.code)).toEqual(["S"]);
    const inside = summarizeEvents([row({ description: "General Session", start: "09:00 AM", end: "05:00 PM" }), row({ description: "Buffet Lunch", start: "12:00 PM", end: "01:00 PM" })]);
    expect(inside.map((e) => e.code)).toEqual(["S", "Lunch"]);
  });
  it.each(["Water Coolers", "Water Coolers Refresh", "Coffee Bar", "Chic-Fil-A", "Chick-Fil-A", "Papa John's", "Concessions", "Portable Concession", "Coat Check", "Organizers Office Break", "All Day Beverage Break", "Critical Minerals Conference Theater", "Doors Open", "General Admission Entry"])("%s is service noise, not a line", (d) => expect(classifyByDescription(d)).toBe(null));
  it("one show line per room and day, spanning its real lines, with the service lines left out", () => {
    const out = summarizeEvents([
      row({ description: "Registration", start: "08:00 AM", end: "06:00 PM", space: "Exhibit Hall A (EXA)" }),
      row({ description: "Critical Materials & Minerals Expo", start: "09:00 AM", end: "05:00 PM", space: "Exhibit Hall A (EXA)" }),
      row({ description: "Water Coolers", start: "08:00 AM", end: "05:00 PM", space: "Exhibit Hall A (EXA)" }),
      row({ description: "Coffee Bar", start: "08:00 AM", end: "02:00 PM", space: "Exhibit Hall A (EXA)" }),
    ]);
    expect(out.map((e) => [e.code, e.start, e.end])).toEqual([["S", 480, 1080]]);
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
  it("keeps two events with the same name but different Event IDs apart", () => {
    const list = summarizeEvents([row({ description: "General Session", eventId: "111" }), row({ description: "General Session", eventId: "222" })]);
    expect(list.length).toBe(2);
    expect(list.map((e) => e.eventId)).toEqual(["111", "222"]);
  });
  it("flags MO? when an event moved in but has no move-out line", () => {
    const list = summarizeEvents([row({ description: "Move In", date: "2026-10-05" }), row({ description: "General Session", date: "2026-10-06" })]);
    const q = list.filter((e) => e.code === "MO?");
    expect(q.length).toBe(1);
    expect(q[0]!.date).toBe("2026-10-06");
    expect(q[0]!.end - q[0]!.start).toBe(180);
    expect(entryLabel(q[0]!)).toMatch(/^MO\? .+-.+$/);
    expect(summarizeEvents([row({ description: "Move In" }), row({ description: "Move Out", date: "2026-10-07" })]).some((e) => e.code === "MO?")).toBe(false);
  });
  it("makes air wall tasks when a room changes shape", () => {
    const t = airwallTasks([
      row({ description: "General Session", date: "2026-10-05", space: "Exhibit Hall AB (EXAB)" }),
      row({ description: "General Session", date: "2026-10-09", space: "Exhibit Hall A (EXA)" }),
      row({ description: "General Session", date: "2026-10-10", space: "Exhibit Hall A (EXA)" }),
    ]);
    expect(t.map((x) => `${x.date} ${x.text}`)).toEqual(["2026-10-06 Make Hall A"]);
  });
  it("lists rooms shared by two events", () => {
    const list = summarizeEvents([row({ description: "General Session", event: "One", eventId: "1" }), row({ description: "General Session", event: "Two", eventId: "2" })]);
    expect(sharedSpaces(list).length).toBe(1);
  });
  it("makes the later shape the same day when one day needs two overlapping shapes", () => {
    const r = (d: string, sp: string, start: string) => row({ description: "General Session", date: d, space: sp, start });
    const t = airwallTasks([
      r("2026-11-02", "Ballroom ABE (BRABE)", "08:00 AM"),
      r("2026-11-11", "Chattahoochee Ballroom (BRFULL)", "08:00 AM"),
      r("2026-11-11", "Ballroom ABE (BRABE)", "11:00 AM"),
    ]);
    expect(t.map((x) => `${x.date} ${x.text}`).sort()).toEqual(["2026-11-09 Make full ballroom", "2026-11-11 Make ABE"]);
  });
  it("end of show load-out stays part of the show, and a client arrival before everything else gets a line", () => {
    const list = summarizeEvents([
      row({ description: "General Admission Entry", start: "10:00 AM", end: "05:00 PM" }),
      row({ description: "End of Show/Vendor Load-out", start: "05:00 PM", end: "06:00 PM" }),
      row({ description: "Move Out - Chair Pickup", start: "07:00 PM", end: "10:00 PM" }),
      row({ description: "Client Arrival", start: "06:15 AM", end: "06:15 AM", event: "Other", eventId: "9" }),
      row({ description: "Buffet Breakfast", start: "07:00 AM", end: "09:00 AM", event: "Other", eventId: "9" }),
    ]);
    expect(list.filter((e) => e.eventId !== "9").map((e) => e.code)).toEqual(["S", "MO"]);
    expect(list.find((e) => e.code === "S" && e.start === 600)!.end).toBe(1080);
    expect(list.filter((e) => e.eventId === "9").map((e) => entryLabel(e))).toEqual(["Client Arr 6:15a", "S 7a-9a"]);
  });
  it("a dinner stays a dinner and joins air wall tasks on the same day with a slash", () => {
    expect(summarizeEvents([row({ description: "Plated Dinner" })]).map((e) => entryLabel(e))).toEqual(["Dinner 8a-5p"]);
  });
  it("treats anything but Definite as pending, and PDF rows with no status as confirmed", () => {
    expect(isPendingRow({ status: "Pending Contract (32)" })).toBe(true);
    expect(isPendingRow({ status: "Definite (30)" })).toBe(false);
    expect(isPendingRow({})).toBe(false);
    expect(isCancelledRow({ event: "CANCELLED - The COBB Tradeshow" })).toBe(true);
  });
  it("ends the show where the move out starts", () => {
    const list = summarizeEvents([
      row({ description: "General Admission Entry", start: "09:15 AM", end: "05:00 PM" }),
      row({ description: "End of Show/Vendor Load-out", start: "05:00 PM", end: "08:00 PM" }),
      row({ description: "Move Out - Chair Pickup", start: "07:00 PM", end: "10:00 PM" }),
    ]);
    expect(entryLabel(list.find((e) => e.code === "S")!)).toBe("S 9:15a-7p");
    expect(entryLabel(list.find((e) => e.code === "MO")!)).toBe("MO 7p-10p");
  });
  it("a smaller move-out day does not move walls, a different event needs them made", () => {
    const h = (d: string, sp: string, event: string, eventId: string) => row({ description: "General Session", date: d, space: sp, event, eventId });
    const t = airwallTasks([
      h("2026-10-26", "Exhibit Hall ABC (EXABC)", "Critical", "1"),
      row({ description: "Move Out", date: "2026-10-30", space: "Exhibit Hall AB (EXAB)", event: "Critical", eventId: "1" }),
      h("2026-11-05", "Exhibit Hall AB (EXAB)", "Front Row", "2"),
      h("2026-11-05", "Exhibit Hall D (EXD)", "DECA", "3"),
    ]);
    expect(t.map((x) => `${x.date} ${x.text}`)).toEqual(["2026-11-02 Make Hall AB"]);
  });
});

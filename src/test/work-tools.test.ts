import { describe, expect, it } from "vitest";
import { classifyEvent, parsePastedShifts, parseShift, summarizeEvents, entryLabel, type EventRow } from "@/lib/work-tools";
import { deckReply, planStage, stairsFor } from "@/lib/deck-solver";

const row = (p: Partial<EventRow>): EventRow => ({ level: 2, usage: "Event (EVT)", start: "08:30 AM", end: "07:00 PM", description: "The COBB Tradeshow", space: "Exhibit Hall AB (EXAB)", date: "2026-10-11", ...p });

describe("schedule shift times", () => {
  it("reads 9a-6p", () => expect(parseShift("9a-6p")).toEqual({ start: 540, end: 1080 }));
  it("reads 8:30am-4:30 as ending in the afternoon", () => expect(parseShift("8:30am-4:30")).toEqual({ start: 510, end: 990 }));
  it("ends overnight shifts the next day", () => expect(parseShift("8p-4a")).toEqual({ start: 1200, end: 1680 }));
  it("blank and OFF are days off", () => { expect(parseShift("")).toBeNull(); expect(parseShift("OFF")).toBeNull(); });
  it("reads a pasted Excel block for Mark Brown", () => {
    const text = "Mark Brown\t9a-6p\t9a-6p\t9a-6p\t9a-6p\t9a-6p\t\t\n603\t9\t9\t9\t9\t9\tOFF\tOFF\nShow Srvc Manager";
    const shifts = parsePastedShifts(text, "2026-10-12");
    expect(shifts.map((s) => s.date)).toEqual(["2026-10-12", "2026-10-13", "2026-10-14", "2026-10-15", "2026-10-16"]);
    expect(shifts[0]).toMatchObject({ start: 540, end: 1080 });
  });
});

describe("Ungerboeck event rules", () => {
  it("ignores the orange Level 1 date header", () => expect(classifyEvent(row({ level: 1, start: "06:00 AM", end: "11:59 PM", description: "Monday, October 12, 2026" }))).toBeNull());
  it("show event is S", () => expect(classifyEvent(row({}))).toBe("S"));
  it("exhibitor move in is Exmi", () => expect(classifyEvent(row({ usage: "Move In (IN)", description: "Move In | Exhibitors" }))).toBe("Exmi"));
  it("decorator move in is MI", () => expect(classifyEvent(row({ usage: "Move In (IN)", description: "Decorator Move In" }))).toBe("MI"));
  it("move out is MO", () => expect(classifyEvent(row({ usage: "Move Out (OUT)", description: "Move Out" }))).toBe("MO"));
  it("merges move-outs into one span", () => {
    const list = summarizeEvents([row({ usage: "Move Out (OUT)", start: "05:00 PM", end: "09:00 PM" }), row({ usage: "Move Out (OUT)", start: "05:00 PM", end: "11:59 PM" })]);
    expect(list.map(entryLabel)).toEqual(["MO 5p-11:59p"]);
  });
});

describe("@deck staging", () => {
  it("24x24 uses 18 decks", () => { const r = planStage(24, 24); expect(r.ok && r.decks.length).toBe(18); });
  it("rejects sizes not a multiple of 4", () => expect(planStage(10, 8).ok).toBe(false));
  it("stairs by height", () => { expect(stairsFor(32)).toBe("5-step"); expect(stairsFor(36)).toBe("6-step"); expect(stairsFor(42)).toBe("7-step"); });
  it("answers @deck 24x24x32", () => expect(deckReply("@deck, 24x24x32")).toContain("18 of 72"));
});

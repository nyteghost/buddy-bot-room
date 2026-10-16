import { describe, expect, it } from "vitest";
import { classifyEvent, escalatorHours, escalatorLabel, expandSpace, parsePastedShifts, parseShift, summarizeEvents, entryLabel, type EventRow } from "@/lib/work-tools";
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
  it("uses the pasted date row when present", () => {
    const text = [
      "FROM:\t10/19/26\tTO:\t10/25/26",
      "DAY\tMON\tTUE\tWED\tTHU\tFRI\tSAT\tSUN\tTOTAL",
      "\t10/19/26\t10/20/26\t10/21/26\t10/22/26\t10/23/26\t10/24/26\t10/25/26",
      "Mark Brown\t9a-6p\t9a-6p\t9a-6p\t9a-6p\t9a-6p\t\t",
      "603\t9\t9\t9\t9\t9\tOFF\tOFF\t45.0",
    ].join("\n");
    const shifts = parsePastedShifts(text, "2026-01-05");
    expect(shifts.map((s) => s.date)).toEqual(["2026-10-19", "2026-10-20", "2026-10-21", "2026-10-22", "2026-10-23"]);
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
    expect(list.filter((e) => e.space === "Hall A").map(entryLabel)).toEqual(["MO 5p-11:59p"]);
  });
});

describe("@deck staging", () => {
  it("24x24 uses 18 decks", () => { const r = planStage(24, 24); expect(r.ok && r.decks.length).toBe(18); });
  it("rejects sizes not a multiple of 4", () => expect(planStage(10, 8).ok).toBe(false));
  it("stairs by height", () => { expect(stairsFor(32)).toBe("5-step"); expect(stairsFor(36)).toBe("6-step"); expect(stairsFor(42)).toBe("7-step"); });
  it("answers @deck 24x24x32", () => expect(deckReply("@deck, 24x24x32")).toContain("18 of 72"));
});

describe("For Scheduling rules", () => {
  it("exhibitor service desk is Exmi", () => expect(classifyEvent(row({ usage: "Move In (IN)", description: "Exhibitor Service Desk" }))).toBe("Exmi"));
  it("splits Exhibit Hall AB into Hall A and Hall B", () => expect(expandSpace("Exhibit Hall AB (EXAB)")).toEqual(["Hall A", "Hall B"]));
  it("Chattahoochee Ballroom covers Ballrooms A–G", () => expect(expandSpace("Chattahoochee Ballroom (BRFULL)")).toHaveLength(7));
  it("escalators run 1 hour before and after the show", () => {
    const h = escalatorHours(summarizeEvents([row({})])).get("2026-10-11")!;
    expect(escalatorLabel(h)).toBe("7:30a-8p");
  });
});

describe("weekly engineering layout", () => {
  it("splits entries into Monday–Sunday weeks with escalator and service desk", async () => {
    const { weekLayouts, mondayOf } = await import("@/lib/work-tools");
    expect(mondayOf("2026-10-11")).toBe("2026-10-05");
    const w = weekLayouts([
      { date: "2026-10-09", space: "Hall A", code: "MI", start: 360, end: 1020, title: "Cobb Trade Show" },
      { date: "2026-10-11", space: "Hall A", code: "S", start: 480, end: 1140, title: "Cobb Trade Show" },
      { date: "2026-10-10", space: "Hall B", code: "Exmi", start: 540, end: 1260, title: "Cobb Trade Show" },
      { date: "2026-10-12", space: "Hall A", code: "MO", start: 480, end: 900, title: "Cobb Trade Show" },
    ]);
    expect(w.map((x) => x.monday)).toEqual(["2026-10-05", "2026-10-12"]);
    expect(w[0]!.escalator[6]).toBe("7a-8p");
    expect(w[0]!.serviceDesk[5]).toBe("9a-9p");
    expect(w[0]!.rows["Hall A"]![4]!.text).toBe("Cobb Trade Show\nMI 6a-5p");
    expect(w[0]!.cgc[0]).toBe("DARK");
  });
});

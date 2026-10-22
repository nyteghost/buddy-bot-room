import { describe, it, expect } from "vitest";
import { EMPTY, addTask, setStatus, extractJson, parseDump, applyDump, fallbackPick, parsePick, parseSmaller, nudgesDue, markNudged, parseCheckins, parseState, openTasks } from "@/lib/today";

let n = 0;
const id = () => `t${++n}`;

describe("today planner logic", () => {
  it("adds tasks once and tracks status", () => {
    let s = addTask(EMPTY, "Call the dentist", "capture", "a", 1);
    s = addTask(s, "call the dentist", "capture", "b", 2);
    expect(s.tasks).toHaveLength(1);
    s = setStatus(s, "a", "done", 5);
    expect(openTasks(s)).toHaveLength(0);
    expect(s.tasks[0]!.doneAt).toBe(5);
  });
  it("pulls JSON out of a chatty reply", () => {
    expect(extractJson('Sure!\n```json\n{"step":"open the file","why":"easy {start}"}\n```')).toEqual({ step: "open the file", why: "easy {start}" });
    expect(extractJson("no json here")).toBe(null);
  });
  it("sorts a brain dump into tiers and skips duplicates", () => {
    const d = parseDump({ opening: "Morning.", tasks: [{ title: "File report", tier: "must", size: "L" }, { title: "Buy milk", tier: "weird" }, { title: "" }] })!;
    expect(d.tasks.map((t) => t.tier)).toEqual(["must", "could"]);
    const s = applyDump(addTask(EMPTY, "Buy milk", "manual", "x", 1), d, id, 10, { date: "2026-10-22", pace: 2, mood: "" });
    expect(s.tasks.map((t) => t.title)).toEqual(["Buy milk", "File report"]);
    expect(s.day?.opening).toBe("Morning.");
  });
  it("falls back to the highest tier and honours not-this-one", () => {
    let s = addTask(EMPTY, "Could do", "manual", "a", 1);
    s = addTask(s, "Must do", "manual", "b", 2);
    s = { ...s, tasks: s.tasks.map((t) => (t.id === "a" ? { ...t, tier: "could" as const } : { ...t, tier: "must" as const })) };
    expect(fallbackPick(s, null)?.id).toBe("b");
    expect(fallbackPick(s, "b")?.id).toBe("a");
    expect(parsePick({ task_id: "#b", reason: "r" }, s, "b")).toBe(null);
    expect(parsePick({ task_id: "#a", reason: "r" }, s, "b")?.id).toBe("a");
  });
  it("reads a smaller step", () => {
    expect(parseSmaller({ step: "Open the doc", why: "tiny" })).toEqual({ step: "Open the doc", why: "tiny" });
    expect(parseSmaller({})).toBe(null);
  });
  it("nudges before an event once and at check-ins", () => {
    const now = Date.parse("2026-10-22T14:00:00Z");
    const base = { now, localMinutes: 13 * 60 + 5, dateKey: "2026-10-22", leadMin: 10, checkins: [13 * 60], s: EMPTY };
    const first = nudgesDue({ ...base, events: [{ title: "Standup", start: now + 8 * 60_000, allDay: false }] });
    expect(first.map((x) => x.title)).toEqual(["Standup in 8 min", "Check-in"]);
    const again = nudgesDue({ ...base, s: markNudged(EMPTY, first.map((x) => x.key)), events: [{ title: "Standup", start: now + 8 * 60_000, allDay: false }] });
    expect(again).toHaveLength(0);
  });
  it("parses check-in times and cleans stored state", () => {
    expect(parseCheckins("12:00, 15:30 bad 25:00")).toEqual([720, 930]);
    expect(parseState({ tasks: [{ id: "a", title: "x", tier: "nope" }, { title: "no id" }], day: { date: "bad" } }).tasks).toHaveLength(1);
  });
});

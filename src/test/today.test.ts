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

import { parseWhen, zonedEpoch, addParsed, dueRoutines, addRoutine, parseWeek, fallbackWeek, weekStats } from "@/lib/today";

describe("times, routines and the week", () => {
  it("reads a time and a length out of a capture line", () => {
    expect(parseWhen("Call the dentist at 3pm")).toMatchObject({ title: "Call the dentist", minutes: 15 * 60 });
    expect(parseWhen("standup 9:30 for 15 min")).toMatchObject({ title: "standup", minutes: 9 * 60 + 30, mins: 15 });
    expect(parseWhen("pick up kids at 3")).toMatchObject({ minutes: 15 * 60 });
    expect(parseWhen("email Sam at 9")).toMatchObject({ minutes: 9 * 60 });
    expect(parseWhen("lunch @12")).toMatchObject({ minutes: 12 * 60 });
    expect(parseWhen("buy 3 apples")).toMatchObject({ title: "buy 3 apples", minutes: null });
    expect(parseWhen("write report for an hour")).toMatchObject({ title: "write report", mins: 60 });
  });
  it("turns a local clock time into the right instant, including daylight saving", () => {
    expect(zonedEpoch("2026-10-22", 15 * 60, "America/New_York")).toBe(Date.UTC(2026, 9, 22, 19, 0));
    expect(zonedEpoch("2026-11-02", 15 * 60, "America/New_York")).toBe(Date.UTC(2026, 10, 2, 20, 0));
  });
  it("puts a timed capture on today, or tomorrow when the time is long past", () => {
    const now = Date.UTC(2026, 9, 22, 20, 0); // 4pm New York
    const a = addParsed(EMPTY, "call mom at 5pm", "capture", "a", now, "2026-10-22", "America/New_York");
    expect(a.tasks[0]!.at).toBe(Date.UTC(2026, 9, 22, 21, 0));
    const b = addParsed(EMPTY, "call mom at 9am", "capture", "b", now, "2026-10-22", "America/New_York");
    expect(b.tasks[0]!.at).toBe(Date.UTC(2026, 9, 23, 13, 0));
  });
  it("brings routines back once a day, on the right days", () => {
    let s = addRoutine(EMPTY, { title: "Build the schedule", repeat: "weekly", dow: 4, time: 600, mins: 90 }, "r1");
    s = addRoutine(s, { title: "Take meds", repeat: "daily", dow: 0, time: null, mins: null }, "r2");
    s = addRoutine(s, { title: "Inbox zero", repeat: "weekdays", dow: 0, time: null, mins: null }, "r3");
    let k = 0;
    const ids = () => `x${++k}`;
    const thu = dueRoutines(s, "2026-10-22", 4, 1, "America/New_York", ids);
    expect(thu.tasks.map((t) => t.title).sort()).toEqual(["Build the schedule", "Inbox zero", "Take meds"]);
    expect(thu.tasks.find((t) => t.title === "Build the schedule")).toMatchObject({ mins: 90, source: "routine" });
    expect(dueRoutines(thu, "2026-10-22", 4, 1, "America/New_York", ids)).toBe(thu);
    const sat = dueRoutines(thu, "2026-10-24", 6, 2, "America/New_York", ids);
    expect(sat.tasks.filter((t) => t.status === "open" && t.title === "Take meds")).toHaveLength(1);
    expect(sat.tasks.filter((t) => t.title === "Inbox zero")).toHaveLength(1);
  });
  it("nudges before a timed task, once", () => {
    const now = Date.UTC(2026, 9, 22, 18, 55);
    const s = addParsed(EMPTY, "dentist at 3pm", "capture", "d", now - 3600_000, "2026-10-22", "America/New_York");
    const due = nudgesDue({ now, localMinutes: 14 * 60 + 55, dateKey: "2026-10-22", events: [], leadMin: 10, checkins: [], s });
    expect(due).toHaveLength(1);
    expect(due[0]!.title).toContain("dentist");
    expect(nudgesDue({ now, localMinutes: 0, dateKey: "x", events: [], leadMin: 10, checkins: [], s: markNudged(s, [due[0]!.key]) })).toHaveLength(0);
  });
  it("picks week focus only from open tasks, and falls back by priority", () => {
    let s = addTask(EMPTY, "A", "manual", "a", 1, { tier: "could" });
    s = addTask(s, "B", "manual", "b", 2, { tier: "must" });
    expect(parseWeek({ focus: ["#a", "zzz", "b"], note: "ok" }, s)).toEqual({ ids: ["a", "b"], note: "ok" });
    expect(parseWeek({ focus: ["zzz"] }, s)).toBe(null);
    expect(fallbackWeek(s)).toEqual(["b", "a"]);
    expect(weekStats(setStatus(s, "a", "done", 100), 50)).toMatchObject({ doneWeek: 1, open: 1 });
  });
  it("keeps old saved lists loading (no routines field)", () => {
    expect(parseState({ tasks: [{ id: "a", title: "x" }] }).routines).toEqual([]);
  });
});

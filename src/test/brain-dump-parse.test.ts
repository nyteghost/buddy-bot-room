import { describe, expect, it } from "vitest";
import { parseBrainDumpLine } from "@/lib/brain-dump-parse";
import { zoneDateKey } from "@/lib/day-overview";
import { wallOf } from "@/lib/when";

const tz = "America/Chicago";
const now = Date.parse("2026-10-30T14:30:00.000Z"); // Friday 9:30 AM CDT

describe("Brain Dump natural-language scheduling", () => {
  it("understands compact punctuation, @time and Tomorrow without making it an alert", () => {
    const p = parseBrainDumpLine("Pick up Kids @5pm,Tomorrow", now, tz)!;
    expect(p).toEqual(expect.objectContaining({ title: "Pick up Kids", dueDate: "2026-10-31", important: false }));
    expect(wallOf(p.scheduledAt!, tz)).toEqual(expect.objectContaining({ y: 2026, mo: 10, d: 31, h: 17, mi: 0 }));
  });
  it("handles days without a time without inventing a 9AM alert", () => {
    expect(parseBrainDumpLine("Finish show schedule tomorrow", now, tz)).toEqual({
      title: "Finish show schedule", dueDate: "2026-10-31", important: false,
    });
    expect(parseBrainDumpLine("Pick up groceries", now, tz)).toEqual({ title: "Pick up groceries", important: false });
  });
  it("accepts Important explicitly with !, while never assuming it from task wording", () => {
    expect(parseBrainDumpLine("! Pick up Kids @5pm,Tomorrow", now, tz)?.important).toBe(true);
    expect(parseBrainDumpLine("Read an important letter", now, tz)?.important).toBe(false);
  });
  it("supports day after tomorrow, clock-first input and 24-hour time", () => {
    const p = parseBrainDumpLine("Send report @14:30 day after tomorrow", now, tz)!;
    expect(p.title).toBe("Send report");
    expect(p.dueDate).toBe("2026-11-01");
    expect(wallOf(p.scheduledAt!, tz)).toEqual(expect.objectContaining({ h: 14, mi: 30 }));
    expect(parseBrainDumpLine("Tomorrow at 5pm, pick up kids", now, tz)?.title).toBe("pick up kids");
  });
  it("uses calendar days rather than 24-hour increments across DST", () => {
    const beforeFallBack = Date.parse("2026-11-01T04:30:00Z"); // Oct 31, 11:30pm CDT
    const p = parseBrainDumpLine("Pick up kids @5pm tomorrow", beforeFallBack, tz)!;
    expect(p.dueDate).toBe("2026-11-01");
    expect(zoneDateKey(p.scheduledAt!, tz)).toBe("2026-11-01");
    expect(wallOf(p.scheduledAt!, tz).h).toBe(17);
  });
  it("never invents a scheduled time from a vague task", () => {
    const p = parseBrainDumpLine("Review docs at some point", now, tz)!;
    expect(p.scheduledAt).toBeUndefined();
    expect(p.title).toContain("Review docs");
  });
});

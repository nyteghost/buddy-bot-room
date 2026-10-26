import { describe, expect, it } from "vitest";
import { nextOccurrence, parseRemindArgs, parseReminders, repeatName, takeRepeat } from "@/lib/reminders";
import { wallOf } from "@/lib/when";

const NY = "America/New_York";
const NOW = Date.parse("2026-10-25T20:00:00-04:00");
const ymd = (ms: number) => { const w = wallOf(ms, NY); return `${w.y}-${String(w.mo).padStart(2, "0")}-${String(w.d).padStart(2, "0")} ${String(w.h).padStart(2, "0")}:${String(w.mi).padStart(2, "0")}`; };

describe("richer reminder repeats", () => {
  it("reads 'every first saturday' and friends", () => {
    expect(takeRepeat("every first saturday 9am check")!.repeat).toBe("nth:1:6");
    expect(takeRepeat("every last friday 5pm close")!.repeat).toBe("nth:-1:5");
    expect(takeRepeat("every other week monday")!.repeat).toBe("biweekly");
    expect(takeRepeat("quarterly filters")!.repeat).toBe("quarterly");
    expect(repeatName("nth:1:6")).toBe("every first Saturday");
  });
  it("starts on the first matching date and keeps going monthly", () => {
    const r = parseRemindArgs("every first saturday 9am PC health check", NOW, NY);
    if ("error" in r) throw new Error(r.error);
    expect(ymd(r.at)).toBe("2026-11-07 09:00");
    expect(ymd(nextOccurrence(r.at, r.repeat!, r.at, NY))).toBe("2026-12-05 09:00");
    const dec = nextOccurrence(r.at, r.repeat!, r.at, NY);
    expect(ymd(nextOccurrence(dec, r.repeat!, dec, NY))).toBe("2027-01-02 09:00");
  });
  it("last friday, every 2 weeks, every 3 months", () => {
    const l = parseRemindArgs("every last friday 5pm close out", NOW, NY);
    if ("error" in l) throw new Error(l.error);
    expect(ymd(l.at)).toBe("2026-10-30 17:00");
    expect(ymd(nextOccurrence(l.at, l.repeat!, l.at, NY))).toBe("2026-11-27 17:00");
    const mon = Date.parse("2026-10-26T09:00:00-04:00");
    expect(ymd(nextOccurrence(mon, "biweekly", mon, NY))).toBe("2026-11-09 09:00");
    expect(ymd(nextOccurrence(mon, "quarterly", mon, NY))).toBe("2027-01-26 09:00");
  });
  it("keeps details and the important flag", () => {
    const r = parseRemindArgs("! tomorrow 9am pay rent || portal login is on the fridge", NOW, NY);
    if ("error" in r) throw new Error(r.error);
    expect(r).toMatchObject({ text: "pay rent", notes: "portal login is on the fridge", important: true });
    const list = parseReminders([{ id: "a", at: NOW, text: "x", repeat: "nth:2:3", notes: "n", important: true }, { id: "b", at: NOW, text: "y", repeat: "nth:9:9" }]);
    expect(list[0]).toMatchObject({ repeat: "nth:2:3", notes: "n", important: true });
    expect(list[1]?.repeat).toBeUndefined();
  });
});

describe("repeats survive the iPhone Reminders sync", () => {
  it("maps the new repeats to and from calendar rules", async () => {
    const { rruleOf, repeatFromRrule } = await import("@/lib/caldav");
    for (const r of ["nth:1:6", "nth:-1:5", "biweekly", "quarterly", "monthly", "weekly", "daily", "weekdays"] as const) expect(repeatFromRrule(rruleOf(r))).toBe(r);
    expect(rruleOf("nth:1:6")).toBe("FREQ=MONTHLY;BYDAY=1SA");
  });
});

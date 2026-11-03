import { describe, expect, it } from "vitest";
import { eventsInRange } from "@/lib/ics";

describe("iCalendar recurring exceptions", () => {
  it("respects DST, removed dates, moved dates, cancellations and explicit additional dates", () => {
    const ics = [
      "BEGIN:VCALENDAR",
      "BEGIN:VEVENT","UID:weekly-meeting","SUMMARY:Project check-in",
      "DTSTART;TZID=America/Chicago:20261030T090000",
      "DTEND;TZID=America/Chicago:20261030T100000",
      "RRULE:FREQ=DAILY;COUNT=5",
      "EXDATE;TZID=America/Chicago:20261031T090000",
      "RDATE;TZID=America/Chicago:20261110T090000,20261110T090000",
      "END:VEVENT",
      "BEGIN:VEVENT","UID:weekly-meeting",
      "RECURRENCE-ID;TZID=America/Chicago:20261101T090000",
      "DTSTART;TZID=America/Chicago:20261101T110000",
      "DTEND;TZID=America/Chicago:20261101T120000",
      "SUMMARY:Rescheduled check-in", "END:VEVENT",
      "BEGIN:VEVENT","UID:weekly-meeting",
      "RECURRENCE-ID;TZID=America/Chicago:20261102T090000",
      "STATUS:CANCELLED",
      "DTSTART;TZID=America/Chicago:20261102T090000", "END:VEVENT",
      "END:VCALENDAR",
    ].join("\r\n");
    const result = eventsInRange(ics, Date.UTC(2026,9,28), Date.UTC(2026,10,12), "America/Chicago");
    expect(result.map(x => x.title)).toEqual(["Project check-in", "Rescheduled check-in", "Project check-in", "Project check-in"]);
    expect(result[0]?.start).toBe(Date.UTC(2026,9,30,14));
    expect(result[1]?.start).toBe(Date.UTC(2026,10,1,17));
    expect(result[2]?.start).toBe(Date.UTC(2026,10,3,15));
    expect(result[3]?.start).toBe(Date.UTC(2026,10,10,15));
  });
});

import { parseWhen, takeDuration } from "./when";

/** Build calendar events from chat and hand back a .ics file plus "add to Google/Outlook" links. Nothing is ever written to your calendar from here. */
export type NewEvent = { title: string; start: number; end: number; allDay: boolean };

export function parseEventArgs(text: string, now: number, tz: string): NewEvent | { error: string } {
  const dur = takeDuration(text);
  const w = parseWhen(dur?.rest ?? text, now, tz, 9);
  const usage = "Try /event friday 3pm dentist, /event tomorrow 10:30 lunch with Sam for 90m, or /event oct 25 mom's birthday.";
  if (!w) return { error: `I need a date or time. ${usage}` };
  if (!w.rest) return { error: `What is the event called? ${usage}` };
  const title = w.rest.slice(0, 120);
  if (!w.hasTime) return { title, start: w.at, end: w.at + 86_400_000, allDay: true };
  return { title, start: w.at, end: w.at + (dur?.minutes ?? 60) * 60_000, allDay: false };
}

const stamp = (ms: number) => new Date(ms).toISOString().replace(/[-:]/g, "").replace(/\.\d{3}/, "");
const ymd = (ms: number, tz: string) => new Intl.DateTimeFormat("en-CA", { timeZone: tz, year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date(ms)).replace(/-/g, "");
const esc = (s: string) => s.replace(/\\/g, "\\\\").replace(/;/g, "\;").replace(/,/g, "\\,").replace(/\r?\n/g, "\\n");

export function buildIcs(e: NewEvent, uid: string, now: number, tz = "UTC"): string {
  const when = e.allDay ? [`DTSTART;VALUE=DATE:${ymd(e.start, tz)}`, `DTEND;VALUE=DATE:${ymd(e.end, tz)}`] : [`DTSTART:${stamp(e.start)}`, `DTEND:${stamp(e.end)}`];
  return ["BEGIN:VCALENDAR", "VERSION:2.0", "PRODID:-//Pixel Pals//Events//EN", "CALSCALE:GREGORIAN", "METHOD:PUBLISH", "BEGIN:VEVENT", `UID:${uid}@pixelpals`, `DTSTAMP:${stamp(now)}`, ...when, `SUMMARY:${esc(e.title)}`, "END:VEVENT", "END:VCALENDAR", ""].join("\r\n");
}

export function eventLinks(e: NewEvent, tz = "UTC"): { google: string; outlook: string } {
  const g = new URLSearchParams({ action: "TEMPLATE", text: e.title, dates: e.allDay ? `${ymd(e.start, tz)}/${ymd(e.end, tz)}` : `${stamp(e.start)}/${stamp(e.end)}` });
  const o = new URLSearchParams({ path: "/calendar/action/compose", rru: "addevent", subject: e.title, startdt: new Date(e.start).toISOString(), enddt: new Date(e.end).toISOString(), ...(e.allDay ? { allday: "true" } : {}) });
  return { google: `https://calendar.google.com/calendar/render?${g}`, outlook: `https://outlook.live.com/calendar/0/deeplink/compose?${o}` };
}

/** Query string for the /api/ics download. */
export const icsQuery = (e: NewEvent): string => new URLSearchParams({ title: e.title, start: String(e.start), end: String(e.end), ...(e.allDay ? { allday: "1" } : {}) }).toString();

export function parseIcsQuery(q: URLSearchParams): NewEvent | null {
  const start = Number(q.get("start"));
  const end = Number(q.get("end"));
  const title = (q.get("title") ?? "").trim().slice(0, 120);
  if (!title || !Number.isFinite(start) || !Number.isFinite(end) || end <= start || end - start > 31 * 86_400_000) return null;
  return { title, start, end, allDay: q.get("allday") === "1" };
}

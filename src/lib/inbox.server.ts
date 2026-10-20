import { currentUser } from "./accounts.server";
import { eventsInRange } from "./ics";
import { fetchUnread, imapConfig } from "./imap.server";
import { googleRange, gcalStatus } from "./gcal.server";
import { m365Range, m365UnreadMail } from "./m365.server";
import { validZone } from "./schedule";
import { logServer } from "./server-log.server";
import { TtlCache } from "./ttl-cache";

/**
 * Data for the Mail and Calendar windows. Owner only (it is your personal mail and calendar), read-only, and addresses/credentials
 * never reach the browser. Calendars: CALENDAR_ICS_URLS (private .ics links, comma separated) plus Microsoft 365 if connected.
 * Mail: IMAP_* (unread subjects only) plus Microsoft 365 if connected.
 */
const tz = () => validZone(process.env["BUDDY_TZ"]) ?? "UTC";
const cache = new TtlCache<unknown>(60_000, 10);

export type CalItem = { title: string; start: number; end: number; allDay: boolean; location: string; source: string };

function icsUrls(): { name: string; url: string }[] {
  return (process.env["CALENDAR_ICS_URLS"] ?? "").split(/[\s,]+/).map((u) => u.trim()).filter(Boolean).slice(0, 6).flatMap((u, i) => {
    try {
      const url = new URL(u.replace(/^webcal:/i, "https:"));
      const host = url.hostname.toLowerCase();
      const label = /(^|\.)cozi\.com$/.test(host) ? "Cozi" : /(^|\.)google\.com$/.test(host) ? "Google Calendar" : /icloud\.com$/.test(host) ? "iCloud" : /(outlook|office365|live)\./.test(host) ? "Outlook" : `Calendar ${i + 1}`;
      return url.protocol === "https:" || url.protocol === "http:" ? [{ name: label, url: url.toString() }] : [];
    } catch { return []; }
  });
}

async function owner(request: Request): Promise<Response | null> {
  const user = await currentUser(request);
  return user?.owner ? null : Response.json({ error: "Only the owner account can open Mail and Calendar." }, { status: 403 });
}

export type CalendarData = { tz: string; configured: boolean; feeds: number; m365: boolean; google: { configured: boolean; connected: boolean; mode?: string }; items: CalItem[]; errors: string[] };
export type MailData = { configured: boolean; imap: boolean; m365: boolean; items: { from: string; subject: string; date: string; source: string }[]; errors: string[] };

export async function handleCalendar(request: Request): Promise<Response> {
  const denied = await owner(request);
  if (denied) return denied;
  return Response.json(await calendarData(Number(new URL(request.url).searchParams.get("days"))));
}

/** Calendar data without the request/owner check, for the owner's own morning brief. */
export async function calendarData(daysIn: number): Promise<CalendarData> {
  const days = Math.min(30, Math.max(1, daysIn || 7));
  const hit = cache.get(`cal|${days}`) as CalendarData | undefined;
  if (hit) return hit;
  const start = new Date(); start.setHours(0, 0, 0, 0);
  const from = start.getTime() - 3600_000;
  const to = from + days * 86400_000;
  const items: CalItem[] = [];
  const errors: string[] = [];
  const feeds = icsUrls();
  await Promise.all(feeds.map(async (f) => {
    try {
      const res = await fetch(f.url, { signal: AbortSignal.timeout(12_000), headers: { Accept: "text/calendar" } });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const text = await res.text();
      if (text.length > 8_000_000) throw new Error("feed too large");
      for (const e of eventsInRange(text, from, to, tz())) items.push({ ...e, source: f.name });
    } catch (e) { errors.push(`${f.name}: ${e instanceof Error ? e.message.slice(0, 60) : "failed"}`); }
  }));
  let m365 = false;
  try { const r = await m365Range(from, to); if (r) { m365 = true; for (const e of r) items.push({ ...e, source: "Microsoft 365" }); } } catch { errors.push("Microsoft 365: couldn't read the calendar"); }
  const google = await gcalStatus();
  try { const r = await googleRange(from, to); if (r) for (const e of r) items.push({ ...e, source: "Google Calendar" }); } catch (e) { errors.push(`Google Calendar: ${e instanceof Error ? e.message.slice(0, 80) : "couldn't read the calendar"}`); }
  items.sort((a, b) => a.start - b.start);
  // A calendar that is both a feed and the connected Google account would list each event twice.
  const seen = new Set<string>();
  const unique = items.filter((e) => { const k = `${e.title.toLowerCase()}|${e.start}`; if (seen.has(k)) return false; seen.add(k); return true; });
  items.length = 0; items.push(...unique);
  const body: CalendarData = { tz: tz(), configured: feeds.length > 0 || m365 || google.connected, google, feeds: feeds.length, m365, items: items.slice(0, 300), errors };
  cache.set(`cal|${days}`, body);
  return body;
}

/** After the mailbox changes (read, moved, deleted, sent) the unread summary must be re-read. */
export const clearMailCache = (): void => cache.clear();

export async function handleMail(request: Request): Promise<Response> {
  const denied = await owner(request);
  if (denied) return denied;
  return Response.json(await mailData());
}

export async function mailData(): Promise<MailData> {
  const hit = cache.get("mail") as MailData | undefined;
  if (hit) return hit;
  const items: MailData["items"] = [];
  const errors: string[] = [];
  const cfg = imapConfig();
  if (cfg) {
    try { for (const m of await fetchUnread(cfg)) items.push({ ...m, source: "Mail" }); }
    catch (e) { logServer("warn", `IMAP failed: ${e instanceof Error ? e.message.slice(0, 80) : "error"}`); errors.push(`Mail: ${e instanceof Error ? e.message.slice(0, 80) : "couldn't connect"}`); }
  }
  let m365 = false;
  try { const r = await m365UnreadMail(); if (r) { m365 = true; for (const m of r) items.push({ ...m, source: "Microsoft 365" }); } } catch { errors.push("Microsoft 365: couldn't read mail"); }
  items.sort((a, b) => (Date.parse(b.date) || 0) - (Date.parse(a.date) || 0));
  const body: MailData = { configured: !!cfg || m365, imap: !!cfg, m365, items: items.slice(0, 25), errors };
  cache.set("mail", body);
  return body;
}

/** Pure helpers for the read-only Microsoft 365 (work) view: today's calendar and unread mail subjects. */
export type M365Op = "connect" | "status" | "today" | "mail" | "summary" | "disconnect";
export type CalEvent = { subject: string; start: string; end: string; location: string; allDay: boolean };
export type MailItem = { subject: string; from: string; received: string };

export const M365_SCOPES = "offline_access User.Read Calendars.Read Mail.ReadBasic";

export function parseM365(arg: string): M365Op {
  const w = arg.trim().toLowerCase().split(/\s+/)[0] ?? "";
  return (["connect", "status", "today", "mail", "summary", "disconnect"] as const).find((o) => o === w) ?? (w === "calendar" ? "today" : w === "inbox" ? "mail" : w === "summarise" ? "summary" : "status");
}

const clock = (iso: string): string => (/T(\d\d:\d\d)/.exec(iso)?.[1] ?? "");

export function shapeEvents(json: unknown, limit = 15): CalEvent[] {
  const list = (json as { value?: unknown })?.value;
  if (!Array.isArray(list)) return [];
  return list.slice(0, limit).map((e: Record<string, unknown>) => {
    const s = e["start"] as { dateTime?: string } | undefined;
    const t = e["end"] as { dateTime?: string } | undefined;
    const loc = e["location"] as { displayName?: string } | undefined;
    return { subject: String(e["subject"] ?? "(no title)").slice(0, 120), start: String(s?.dateTime ?? ""), end: String(t?.dateTime ?? ""), location: String(loc?.displayName ?? "").slice(0, 80), allDay: e["isAllDay"] === true };
  });
}

export function shapeMail(json: unknown, limit = 10): MailItem[] {
  const list = (json as { value?: unknown })?.value;
  if (!Array.isArray(list)) return [];
  return list.slice(0, limit).map((m: Record<string, unknown>) => {
    const from = (m["from"] as { emailAddress?: { name?: string; address?: string } } | undefined)?.emailAddress;
    return { subject: String(m["subject"] ?? "(no subject)").slice(0, 120), from: String(from?.name || from?.address || "Unknown").slice(0, 60), received: String(m["receivedDateTime"] ?? "") };
  });
}

export function eventsText(events: CalEvent[]): string {
  if (!events.length) return "Nothing on your work calendar for the rest of today.";
  return events.map((e) => `• ${e.allDay ? "All day" : `${clock(e.start)}–${clock(e.end)}`}  ${e.subject}${e.location ? ` (${e.location})` : ""}`).join("\n");
}

export function mailText(items: MailItem[]): string {
  if (!items.length) return "No unread work mail.";
  return `Unread work mail (subjects only; bodies are never read):\n${items.map((m) => `• ${m.from}: ${m.subject}`).join("\n")}`;
}

/** A short prompt for the local model: work data stays on your own server. */
export function summaryPrompt(events: CalEvent[], mail: MailItem[]): string {
  return `Summarise my work day in under 80 words: what is coming up and which unread emails look most important to answer first.\n\nCalendar:\n${eventsText(events)}\n\n${mailText(mail)}`;
}

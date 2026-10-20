import type { AgentId } from "./agents";

/**
 * Real data for the pals, only when you ask about it (an @mail, @calendar or @tasks mention, or "my day"/"my inbox"):
 * short plain text built from what the Calendar and Mail windows already load, plus your open tasks. Subjects and event
 * titles go to the AI you chose for that turn, so nothing is sent unless you ask.
 */
export type DayEvent = { title: string; start: number; end: number; allDay: boolean; location?: string; source?: string };
export type DayMail = { from: string; subject: string; date: string };
export type DayWant = { calendar: boolean; mail: boolean; tasks: boolean };

const clean = (s: string, n: number) => s.replace(/[\r\n]+/g, " ").replace(/\s+/g, " ").trim().slice(0, n);

/** What a message asks for: the pal's own job (when @mentioned) or a phrase like "my day" / "my inbox". */
export function dayWant(text: string, mentioned: AgentId | null): DayWant {
  const t = text.toLowerCase();
  const day = /\b(my day|my schedule|my agenda|what('| i)?s on (today|tomorrow|this week)|what do i have)\b/.test(t);
  return {
    calendar: mentioned === "sage" || day || /\b(my calendar|my events|my meetings|this week'?s? (events|meetings))\b/.test(t),
    mail: mentioned === "nova" || day || /\b(my inbox|my (unread )?(mail|email|emails)|unread (mail|email))\b/.test(t),
    tasks: mentioned === "byte" || day || /\b(my tasks|my to-?dos?|my reminders|what do i need to do)\b/.test(t),
  };
}
export const wantsAny = (w: DayWant): boolean => w.calendar || w.mail || w.tasks;

export function calendarText(items: DayEvent[], zone: string, now = Date.now()): string {
  const upcoming = items.filter((e) => e.end >= now - 3600_000).slice(0, 30);
  if (!upcoming.length) return "Calendar, next 7 days: nothing scheduled.";
  const day = new Intl.DateTimeFormat("en-US", { timeZone: zone, weekday: "short", month: "short", day: "numeric" });
  const time = new Intl.DateTimeFormat("en-US", { timeZone: zone, hour: "numeric", minute: "2-digit" });
  return `Calendar, next 7 days (${upcoming.length} item${upcoming.length === 1 ? "" : "s"}):\n` + upcoming.map((e) => `- ${day.format(e.start)}${e.allDay ? ", all day" : ` ${time.format(e.start)}`}: ${clean(e.title, 80)}${e.location ? ` (${clean(e.location, 40)})` : ""}`).join("\n");
}
export function mailText(items: DayMail[]): string {
  if (!items.length) return "Unread mail: none.";
  return `Unread mail, newest first (${items.length}; subjects only, bodies are not available):\n` + items.slice(0, 12).map((m) => `- ${clean(m.from, 40)}: ${clean(m.subject, 90)}`).join("\n");
}
export function tasksText(todos: { text: string; done: boolean }[]): string {
  const open = todos.filter((t) => !t.done);
  if (!open.length) return "Open tasks: none.";
  return `Open tasks (${open.length}):\n` + open.slice(0, 20).map((t) => `- ${clean(t.text, 100)}`).join("\n");
}

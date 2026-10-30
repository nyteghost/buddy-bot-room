import { offsetDateKey, zoneDateKey } from "./day-overview";
import { parseWhen } from "./when";

export type ParsedBrainTask = {
  title: string;
  /** Local calendar date (YYYY-MM-DD), including date-only entries. */
  dueDate?: string;
  /** Exact timestamp, only when an actual clock time was given. */
  scheduledAt?: number;
  /** Opt-in alert marker. Can also be enabled later with the Important checkbox. */
  important: boolean;
};

/**
 * No remote AI or guesswork: parse a clear day/time, leave unrecognized prose intact.
 * "Pick up Kids @5pm,Tomorrow" => title, tomorrow's date, 5 PM in the device timezone.
 * Starting a line with ! means Important (an alert is added only if a time is known).
 */
export function parseBrainDumpLine(raw: string, now: number, timezone: string): ParsedBrainTask | null {
  let text = raw.trim();
  if (!text) return null;
  const important = /^!+\s*/.test(text);
  if (important) text = text.replace(/^!+\s*/, "");
  if (!text) return null;

  // Make a compact @time marker readable by the established wall-clock parser.
  text = text.replace(/@\s*(?=\d{1,2}(?::\d{2})?\s*(?:am|pm)\b|\d{1,2}:\d{2}\b)/gi, " at ");

  // Convert relative *calendar* dates before parsing. Adding 24 hours to now
  // produces the wrong date around daylight-saving changes.
  const key = zoneDateKey(now, timezone);
  text = text.replace(/\b(?:the\s+)?day\s+after\s+tomorrow\b/gi, offsetDateKey(key, 2));
  text = text.replace(/\b(?:the\s+)?day\s+after\b(?=\s*(?:,|at\b|@|$))/gi, offsetDateKey(key, 2));
  text = text.replace(/\btomorrow\b/gi, offsetDateKey(key, 1));
  text = text.replace(/\btoday\b/gi, key);

  // With no usable calendar instruction, this is just an ordinary captured thought.
  const when = parseWhen(text, now, timezone);
  if (!when) return { title: raw.trim().replace(/^!+\s*/, "").slice(0, 200), important };

  // Do not capture a blank task or silently turn an invalid title into a reminder.
  const title = when.rest.replace(/^[\s,@;]+|[\s,@;]+$/g, "").trim().slice(0, 200);
  if (!title) return null;
  const dueDate = zoneDateKey(when.at, timezone);
  return when.hasTime ? { title, dueDate, scheduledAt: when.at, important } : { title, dueDate, important };
}

export function localDateTimeValue(at: number): string {
  const d = new Date(at);
  const pad = (n: number) => String(n).padStart(2, "0");
  return d.getFullYear() + "-" + pad(d.getMonth() + 1) + "-" + pad(d.getDate()) + "T" + pad(d.getHours()) + ":" + pad(d.getMinutes());
}

import { isDue, parseHm, zonedParts } from "./schedule";

/** Recurring tasks the pals run for you on the server, with the answer sent to your phone. Pure helpers. */
export type Days = "daily" | "weekdays" | "weekends";
export type Schedule = { id: string; time: string; days: Days; prompt: string; last: string; lastResult: string };

export const MAX_SCHEDULES = 12;
export const MAX_PROMPT = 500;

const DAYS: Days[] = ["daily", "weekdays", "weekends"];

export function parseSchedules(raw: unknown): Schedule[] {
  if (!Array.isArray(raw)) return [];
  const out: Schedule[] = [];
  for (const r of raw) {
    if (!r || typeof r !== "object") continue;
    const o = r as Record<string, unknown>;
    const time = parseHm(typeof o["time"] === "string" ? o["time"] : "", "");
    const prompt = typeof o["prompt"] === "string" ? o["prompt"].trim().slice(0, MAX_PROMPT) : "";
    const days = DAYS.find((d) => d === o["days"]) ?? "daily";
    if (!time || !prompt || typeof o["id"] !== "string") continue;
    out.push({ id: o["id"].slice(0, 12), time, days, prompt, last: typeof o["last"] === "string" ? o["last"].slice(0, 10) : "", lastResult: typeof o["lastResult"] === "string" ? o["lastResult"].slice(0, 600) : "" });
    if (out.length >= MAX_SCHEDULES) break;
  }
  return out;
}

/** "08:00 weekdays what is on my plate" → parts. Days are optional (default daily). */
export function parseScheduleArgs(text: string): { time: string; days: Days; prompt: string } | { error: string } {
  const m = /^\s*(\d{1,2}:\d{2})\s+(?:(daily|weekdays|weekends)\s+)?([\s\S]+)$/i.exec(text);
  if (!m) return { error: "Use: /schedule add 08:00 weekdays what should I know today?" };
  const [h, min] = (m[1] ?? "").split(":");
  const time = parseHm(`${(h ?? "").padStart(2, "0")}:${min}`, "");
  if (!time) return { error: "That time isn't valid. Use 24-hour HH:MM, for example 07:30." };
  const prompt = (m[3] ?? "").trim();
  if (!prompt) return { error: "What should the pals do at that time?" };
  return { time, days: ((m[2] ?? "daily").toLowerCase() as Days), prompt: prompt.slice(0, MAX_PROMPT) };
}

export function addSchedule(list: Schedule[], time: string, days: Days, prompt: string, id: string): { ok: true; list: Schedule[] } | { ok: false; error: string } {
  if (list.length >= MAX_SCHEDULES) return { ok: false, error: `You can keep up to ${MAX_SCHEDULES} scheduled tasks. Remove one first.` };
  return { ok: true, list: [...list, { id, time, days, prompt, last: "", lastResult: "" }] };
}

/** Remove by list number (1-based) or id. */
export function removeSchedule(list: Schedule[], which: string): { list: Schedule[]; removed: Schedule | undefined } {
  const n = Number(which);
  const target = Number.isInteger(n) && n >= 1 ? list[n - 1] : list.find((s) => s.id === which);
  return { list: list.filter((s) => s !== target), removed: target };
}

function weekdayIn(now: Date, tz: string): number {
  const name = new Intl.DateTimeFormat("en-US", { timeZone: tz, weekday: "short" }).format(now);
  return ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"].indexOf(name);
}

export function dayMatches(days: Days, now: Date, tz: string): boolean {
  const d = weekdayIn(now, tz);
  return days === "daily" || (days === "weekdays" ? d >= 1 && d <= 5 : d === 0 || d === 6);
}

export function scheduleDue(s: Schedule, now: Date, tz: string): boolean {
  return dayMatches(s.days, now, tz) && isDue(now, tz, s.time, s.last);
}

export const today = (now: Date, tz: string): string => zonedParts(now, tz).day;

export function scheduleList(list: Schedule[]): string {
  if (!list.length) return "No scheduled tasks yet. Try: /schedule add 08:00 weekdays what should I know today?";
  return list.map((s, i) => `${i + 1}. ${s.time} ${s.days} — ${s.prompt}${s.lastResult ? `\n   Last answer: ${s.lastResult.slice(0, 120)}${s.lastResult.length > 120 ? "…" : ""}` : ""}`).join("\n");
}

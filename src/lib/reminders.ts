import { fromWall, parseWhen, wallOf, whenLabel } from "./when";

/** Reminders the server pushes to your phone (ntfy/Telegram). One-shot, or repeating (daily, weekdays, weekly, monthly). */
/** "nth:1:6" = the first Saturday of every month; "nth:-1:5" = the last Friday. */
export type Repeat = "daily" | "weekdays" | "weekly" | "biweekly" | "monthly" | "quarterly" | `nth:${number}:${number}`;
export type Reminder = { id: string; at: number; text: string; repeat?: Repeat | undefined; notes?: string | undefined; important?: boolean | undefined };
export const MAX_REMINDERS = 50;
const REPEATS: string[] = ["daily", "weekdays", "weekly", "biweekly", "monthly", "quarterly"];
export const validRepeat = (r: unknown): r is Repeat => typeof r === "string" && (REPEATS.includes(r) || /^nth:(?:[1-4]|-1):[0-6]$/.test(r));
export const MAX_NOTES = 2000;

export function parseReminders(raw: unknown): Reminder[] {
  if (!Array.isArray(raw)) return [];
  return raw.flatMap((r): Reminder[] => {
    const o = r as Partial<Reminder> | null;
    if (!(o && typeof o.id === "string" && typeof o.at === "number" && Number.isFinite(o.at) && typeof o.text === "string" && o.text)) return [];
    const base: Reminder = { id: o.id.slice(0, 24), at: o.at, text: o.text.slice(0, 300) };
    if (validRepeat(o.repeat)) base.repeat = o.repeat;
    if (typeof o.notes === "string" && o.notes.trim()) base.notes = o.notes.slice(0, MAX_NOTES);
    if (o.important === true) base.important = true;
    return [base];
  }).slice(0, MAX_REMINDERS);
}

/** Pull "every day", "daily", "every weekday", "every monday", "weekly", "every month" out of the text. */
export function takeRepeat(text: string): { repeat: Repeat; rest: string } | null {
  const ord: Record<string, number> = { first: 1, "1st": 1, second: 2, "2nd": 2, third: 3, "3rd": 3, fourth: 4, "4th": 4, last: -1 };
  const wds = ["sun", "mon", "tue", "wed", "thu", "fri", "sat"];
  const nth = /\b(?:every|each|on the)\s+(first|1st|second|2nd|third|3rd|fourth|4th|last)\s+(sun|mon|tue|wed|thu|fri|sat)[a-z]*(?:\s+of\s+(?:the\s+|every\s+|each\s+)?month)?/i.exec(text);
  if (nth) {
    const n = ord[(nth[1] ?? "").toLowerCase()] ?? 1;
    const d = wds.indexOf((nth[2] ?? "").toLowerCase().slice(0, 3));
    return { repeat: `nth:${n}:${d}` as Repeat, rest: text.replace(nth[0], " ").replace(/\s+/g, " ").trim() };
  }
  const rules: [RegExp, Repeat, string][] = [
    [/\bevery\s+other\s+week\b|\bbi-?weekly\b|\bevery\s+2\s+weeks\b|\bfortnightly\b/i, "biweekly", " "],
    [/\bquarterly\b|\bevery\s+3\s+months\b|\bevery\s+quarter\b/i, "quarterly", " "],
    [/\bevery\s+(?:week\s?days?|work\s?days?)\b|\bweekdays\b/i, "weekdays", " "],
    [/\bevery\s*day\b|\bdaily\b|\beach\s+day\b/i, "daily", " "],
    [/\bevery\s+month\b|\bmonthly\b/i, "monthly", " "],
    [/\bevery\s+week\b|\bweekly\b/i, "weekly", " "],
    [/\bevery\s+((?:sun|mon|tues?|wed(?:nes)?|thu(?:rs)?|fri|sat(?:ur)?)[a-z]*)\b/i, "weekly", " $1 "],
  ];
  for (const [re, repeat, keep] of rules) {
    if (re.test(text)) return { repeat, rest: text.replace(re, keep).replace(/\s+/g, " ").trim() };
  }
  return null;
}

/** "in 30m call mom", "tomorrow 9am pay rent", "every monday 9am team notes", "every day 8pm take pills". */
export type RemindParsed = { at: number; text: string; repeat?: Repeat; notes?: string; important?: boolean };
export function parseRemindArgs(input: string, now: number, tz: string): RemindParsed | { error: string } {
  // "...  || long details" keeps the details out of the 300-character headline; "!" or the word important flags it.
  const [head = "", ...more] = input.split("||");
  const notes = more.join("||").trim().slice(0, MAX_NOTES);
  const important = /(^|\s)!{1,3}(\s|$)|\bimportant\b|\burgent\b/i.test(head);
  const text = head.replace(/(^|\s)!{1,3}(?=\s|$)/g, " ").replace(/\b(?:important|urgent)\b[:,]?/gi, " ").replace(/\s+/g, " ").trim();
  const rep = takeRepeat(text);
  const w = parseWhen(rep?.rest ?? text, now, tz, 9);
  if (!w) return { error: "Tell me when, like /remind in 30m call mom, /remind tomorrow 9am pay rent, /remind every monday 9am send the report, or /remind every day 8pm take pills." };
  if (w.at <= now) return { error: "That time has already passed." };
  const what = w.rest.slice(0, 300);
  if (!what) return { error: "What should I remind you about? For example: /remind in 1h take the laundry out." };
  let at = w.at;
  const nthM = rep ? /^nth:(-?\d):(\d)$/.exec(rep.repeat) : null;
  if (nthM) at = nthOnOrAfter(w.at, Number(nthM[1]), Number(nthM[2]), now, tz);
  const out: RemindParsed = { at, text: what };
  if (rep) out.repeat = rep.repeat;
  if (notes) out.notes = notes;
  if (important) out.important = true;
  return out;
}

/** The next time a repeating reminder should fire after `after`, keeping the same wall-clock time. */
/** The date (day of month) of the nth weekday of a month: n = 1..4, or -1 for the last. */
function nthWeekdayDay(y: number, mo: number, n: number, wd: number, tz: string): number {
  const dim = new Date(Date.UTC(y, mo, 0)).getUTCDate();
  if (n > 0) {
    const first = wallOf(fromWall(y, mo, 1, 12, 0, tz), tz).wd;
    return 1 + ((wd - first + 7) % 7) + (n - 1) * 7;
  }
  const lastWd = wallOf(fromWall(y, mo, dim, 12, 0, tz), tz).wd;
  return dim - ((lastWd - wd + 7) % 7);
}

/** The first time at or after `from` (strictly after when `strict`) that falls on the nth weekday of a month, at the same clock time as `at`. */
export function nthOnOrAfter(at: number, n: number, wd: number, from: number, tz: string, strict = false): number {
  const w = wallOf(at, tz);
  let { y, mo } = wallOf(Math.max(from, 0), tz);
  for (let i = 0; i < 30; i++) {
    const d = nthWeekdayDay(y, mo, n, wd, tz);
    const t = fromWall(y, mo, d, w.h, w.mi, tz);
    if (strict ? t > from : t >= from) return t;
    mo += 1; if (mo > 12) { mo = 1; y += 1; }
  }
  return at;
}

export function nextOccurrence(at: number, repeat: Repeat, after: number, tz: string): number {
  const nthMatch = /^nth:(-?\d):(\d)$/.exec(repeat);
  if (nthMatch) return nthOnOrAfter(at, Number(nthMatch[1]), Number(nthMatch[2]), Math.max(after, at), tz, true);
  const w = wallOf(at, tz);
  let t = at;
  for (let i = 0; i < 800 && t <= after; i++) {
    const c = wallOf(t, tz);
    const noon = fromWall(c.y, c.mo, c.d, 12, 0, tz);
    let next: { y: number; mo: number; d: number };
    if (repeat === "monthly" || repeat === "quarterly") {
      const step = repeat === "quarterly" ? 3 : 1;
      const m0 = c.mo - 1 + step;
      next = { y: c.y + Math.floor(m0 / 12), mo: (m0 % 12) + 1, d: Math.min(w.d, 28) };
    } else {
      let days = repeat === "weekly" ? 7 : repeat === "biweekly" ? 14 : 1;
      let n = wallOf(noon + days * 86_400_000, tz);
      while (repeat === "weekdays" && (n.wd === 0 || n.wd === 6)) { days += 1; n = wallOf(noon + days * 86_400_000, tz); }
      next = { y: n.y, mo: n.mo, d: n.d };
    }
    t = fromWall(next.y, next.mo, next.d, w.h, w.mi, tz);
  }
  return t;
}

export function addReminder(list: Reminder[], at: number, text: string, id: string, repeat?: Repeat, extra: { notes?: string | undefined; important?: boolean | undefined } = {}): { ok: true; list: Reminder[] } | { ok: false; error: string } {
  if (list.length >= MAX_REMINDERS) return { ok: false, error: `You already have ${MAX_REMINDERS} reminders waiting.` };
  const r: Reminder = { id, at, text };
  if (repeat) r.repeat = repeat;
  if (extra.notes?.trim()) r.notes = extra.notes.trim().slice(0, MAX_NOTES);
  if (extra.important) r.important = true;
  return { ok: true, list: [...list, r].sort((a, b) => a.at - b.at) };
}

export const dueReminders = (list: Reminder[], now: number): Reminder[] => list.filter((r) => r.at <= now);

/** After pushing the due ones: one-shots go away, repeating ones move to their next time. */
export function afterFiring(list: Reminder[], due: Reminder[], now: number, tz: string): Reminder[] {
  const ids = new Set(due.map((d) => d.id));
  return list.flatMap((r): Reminder[] => (!ids.has(r.id) ? [r] : r.repeat ? [{ ...r, at: nextOccurrence(r.at, r.repeat, now, tz) }] : [])).sort((a, b) => a.at - b.at);
}

export function removeReminder(list: Reminder[], which: string): { list: Reminder[]; removed: Reminder | undefined } {
  const n = Number(which);
  const target = Number.isInteger(n) && n >= 1 ? list[n - 1] : list.find((r) => r.id === which);
  return { list: target ? list.filter((r) => r !== target) : list, removed: target };
}

/** "10m", "1h", "2 hours", "tomorrow" → minutes from now (tomorrow = next 9am). Null when it can't be read. */
export function snoozeTarget(text: string, now: number, tz: string): number | null {
  const t = text.trim() || "10m";
  const m = /^(\d+(?:\.\d+)?)\s*(minutes?|mins?|m|hours?|hrs?|h)$/i.exec(t);
  if (m) {
    const v = Number(m[1]);
    const ms = /^h/i.test(m[2] ?? "") ? v * 3_600_000 : v * 60_000;
    return v > 0 && ms <= 7 * 86_400_000 ? now + ms : null;
  }
  const w = parseWhen(t, now, tz, 9);
  return w && w.at > now && !w.rest ? w.at : null;
}

export function snoozeReminder(list: Reminder[], which: string, to: number): { list: Reminder[]; changed: Reminder | undefined } {
  const n = Number(which);
  const target = Number.isInteger(n) && n >= 1 ? list[n - 1] : list.find((r) => r.id === which);
  if (!target) return { list, changed: undefined };
  const changed = { ...target, at: to };
  return { list: list.map((r) => (r === target ? changed : r)).sort((a, b) => a.at - b.at), changed };
}

const ORD_LABEL: Record<string, string> = { "1": "first", "2": "second", "3": "third", "4": "fourth", "-1": "last" };
const DAY_LABEL = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];
/** "every weekday", "every first Saturday", "every 2 weeks"... without the leading dot. */
export function repeatName(r: Repeat | undefined): string {
  if (!r) return "";
  const m = /^nth:(-?\d):(\d)$/.exec(r);
  if (m) return `every ${ORD_LABEL[m[1] ?? ""] ?? ""} ${DAY_LABEL[Number(m[2])] ?? ""}`;
  return r === "weekdays" ? "every weekday" : r === "biweekly" ? "every 2 weeks" : r === "quarterly" ? "every 3 months" : r;
}
export const repeatLabel = (r: Repeat | undefined): string => (r ? ` · ${repeatName(r)}` : "");

export function reminderList(list: Reminder[], tz: string): string {
  if (!list.length) return "No reminders waiting. Try /remind in 30m call mom.";
  return list.map((r, i) => `${i + 1}. ${whenLabel(r.at, tz)}${repeatLabel(r.repeat)} — ${r.text}`).join("\n");
}

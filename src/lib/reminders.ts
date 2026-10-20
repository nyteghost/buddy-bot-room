import { fromWall, parseWhen, wallOf, whenLabel } from "./when";

/** Reminders the server pushes to your phone (ntfy/Telegram). One-shot, or repeating (daily, weekdays, weekly, monthly). */
export type Repeat = "daily" | "weekdays" | "weekly" | "monthly";
export type Reminder = { id: string; at: number; text: string; repeat?: Repeat | undefined };
export const MAX_REMINDERS = 50;
const REPEATS: Repeat[] = ["daily", "weekdays", "weekly", "monthly"];

export function parseReminders(raw: unknown): Reminder[] {
  if (!Array.isArray(raw)) return [];
  return raw.flatMap((r): Reminder[] => {
    const o = r as Partial<Reminder> | null;
    if (!(o && typeof o.id === "string" && typeof o.at === "number" && Number.isFinite(o.at) && typeof o.text === "string" && o.text)) return [];
    const base = { id: o.id.slice(0, 24), at: o.at, text: o.text.slice(0, 300) };
    return [REPEATS.includes(o.repeat as Repeat) ? { ...base, repeat: o.repeat as Repeat } : base];
  }).slice(0, MAX_REMINDERS);
}

/** Pull "every day", "daily", "every weekday", "every monday", "weekly", "every month" out of the text. */
export function takeRepeat(text: string): { repeat: Repeat; rest: string } | null {
  const rules: [RegExp, Repeat, string][] = [
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
export function parseRemindArgs(text: string, now: number, tz: string): { at: number; text: string; repeat?: Repeat } | { error: string } {
  const rep = takeRepeat(text);
  const w = parseWhen(rep?.rest ?? text, now, tz, 9);
  if (!w) return { error: "Tell me when, like /remind in 30m call mom, /remind tomorrow 9am pay rent, /remind every monday 9am send the report, or /remind every day 8pm take pills." };
  if (w.at <= now) return { error: "That time has already passed." };
  const what = w.rest.slice(0, 300);
  if (!what) return { error: "What should I remind you about? For example: /remind in 1h take the laundry out." };
  return rep ? { at: w.at, text: what, repeat: rep.repeat } : { at: w.at, text: what };
}

/** The next time a repeating reminder should fire after `after`, keeping the same wall-clock time. */
export function nextOccurrence(at: number, repeat: Repeat, after: number, tz: string): number {
  const w = wallOf(at, tz);
  let t = at;
  for (let i = 0; i < 800 && t <= after; i++) {
    const c = wallOf(t, tz);
    const noon = fromWall(c.y, c.mo, c.d, 12, 0, tz);
    let next: { y: number; mo: number; d: number };
    if (repeat === "monthly") {
      const mo = c.mo === 12 ? 1 : c.mo + 1;
      next = { y: c.mo === 12 ? c.y + 1 : c.y, mo, d: Math.min(w.d, 28) };
    } else {
      let days = repeat === "weekly" ? 7 : 1;
      let n = wallOf(noon + days * 86_400_000, tz);
      while (repeat === "weekdays" && (n.wd === 0 || n.wd === 6)) { days += 1; n = wallOf(noon + days * 86_400_000, tz); }
      next = { y: n.y, mo: n.mo, d: n.d };
    }
    t = fromWall(next.y, next.mo, next.d, w.h, w.mi, tz);
  }
  return t;
}

export function addReminder(list: Reminder[], at: number, text: string, id: string, repeat?: Repeat): { ok: true; list: Reminder[] } | { ok: false; error: string } {
  if (list.length >= MAX_REMINDERS) return { ok: false, error: `You already have ${MAX_REMINDERS} reminders waiting.` };
  const r: Reminder = repeat ? { id, at, text, repeat } : { id, at, text };
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

export const repeatLabel = (r: Repeat | undefined): string => (r === "weekdays" ? " · every weekday" : r ? ` · ${r}` : "");

export function reminderList(list: Reminder[], tz: string): string {
  if (!list.length) return "No reminders waiting. Try /remind in 30m call mom.";
  return list.map((r, i) => `${i + 1}. ${whenLabel(r.at, tz)}${repeatLabel(r.repeat)} — ${r.text}`).join("\n");
}

import { parseWhen, whenLabel } from "./when";

/** One-shot reminders the server pushes to your phone (ntfy/Telegram). */
export type Reminder = { id: string; at: number; text: string };
export const MAX_REMINDERS = 50;

export function parseReminders(raw: unknown): Reminder[] {
  if (!Array.isArray(raw)) return [];
  return raw.flatMap((r): Reminder[] => {
    const o = r as Partial<Reminder> | null;
    return o && typeof o.id === "string" && typeof o.at === "number" && Number.isFinite(o.at) && typeof o.text === "string" && o.text ? [{ id: o.id.slice(0, 24), at: o.at, text: o.text.slice(0, 300) }] : [];
  }).slice(0, MAX_REMINDERS);
}

/** "in 30m call mom", "tomorrow 9am pay rent", "at 15:00 stand up". */
export function parseRemindArgs(text: string, now: number, tz: string): { at: number; text: string } | { error: string } {
  const w = parseWhen(text, now, tz, 9);
  if (!w) return { error: "Tell me when, like /remind in 30m call mom, /remind tomorrow 9am pay rent, or /remind friday at 3pm submit report." };
  if (w.at <= now) return { error: "That time has already passed." };
  const what = w.rest.slice(0, 300);
  if (!what) return { error: "What should I remind you about? For example: /remind in 1h take the laundry out." };
  return { at: w.at, text: what };
}

export function addReminder(list: Reminder[], at: number, text: string, id: string): { ok: true; list: Reminder[] } | { ok: false; error: string } {
  if (list.length >= MAX_REMINDERS) return { ok: false, error: `You already have ${MAX_REMINDERS} reminders waiting.` };
  return { ok: true, list: [...list, { id, at, text }].sort((a, b) => a.at - b.at) };
}

export const dueReminders = (list: Reminder[], now: number): Reminder[] => list.filter((r) => r.at <= now);

export function removeReminder(list: Reminder[], which: string): { list: Reminder[]; removed: Reminder | undefined } {
  const n = Number(which);
  const target = Number.isInteger(n) && n >= 1 ? list[n - 1] : list.find((r) => r.id === which);
  return { list: target ? list.filter((r) => r !== target) : list, removed: target };
}

export function reminderList(list: Reminder[], tz: string): string {
  if (!list.length) return "No reminders waiting. Try /remind in 30m call mom.";
  return list.map((r, i) => `${i + 1}. ${whenLabel(r.at, tz)} — ${r.text}`).join("\n");
}

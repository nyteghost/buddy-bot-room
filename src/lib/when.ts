/** Plain-English date and time parsing for /remind and /event. Pure; everything is read as wall-clock time in the given zone. */
type Wall = { y: number; mo: number; d: number; h: number; mi: number; wd: number };

export function wallOf(ms: number, tz: string): Wall {
  const parts = Object.fromEntries(new Intl.DateTimeFormat("en-US", { timeZone: tz, hourCycle: "h23", year: "numeric", month: "numeric", day: "numeric", hour: "numeric", minute: "numeric", weekday: "short" }).formatToParts(new Date(ms)).map((p) => [p.type, p.value]));
  const wd = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"].indexOf(parts["weekday"] ?? "");
  return { y: Number(parts["year"]), mo: Number(parts["month"]), d: Number(parts["day"]), h: Number(parts["hour"]) % 24, mi: Number(parts["minute"]), wd };
}

/** The instant at which the zone's wall clock reads this time. */
export function fromWall(y: number, mo: number, d: number, h: number, mi: number, tz: string): number {
  let guess = Date.UTC(y, mo - 1, d, h, mi);
  for (let i = 0; i < 2; i++) {
    const w = wallOf(guess, tz);
    guess -= Date.UTC(w.y, w.mo - 1, w.d, w.h, w.mi) - Date.UTC(y, mo - 1, d, h, mi);
  }
  return guess;
}

const MONTHS = ["jan", "feb", "mar", "apr", "may", "jun", "jul", "aug", "sep", "oct", "nov", "dec"];
const DAYS = ["sun", "mon", "tue", "wed", "thu", "fri", "sat"];
const MON = "(jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec)[a-z]*\\.?";

export type When = { at: number; hasTime: boolean; rest: string };

function tidy(s: string): string {
  return s.replace(/\s+/g, " ").replace(/^[\s,;:\-–—]+|[\s,;:\-–—]+$/g, "").replace(/^(to|that|about|for|on|at|me to|me about)\s+/i, "").replace(/\s+(on|at|by|for)$/i, "").trim();
}

/** Find a date and/or time anywhere in the text. Returns the instant and what is left over (the title). Null if nothing was found. */
export function parseWhen(input: string, now: number, tz: string, defaultHour = 9): When | null {
  let text = ` ${input} `;
  const take = (re: RegExp): RegExpMatchArray | null => {
    const m = text.match(re);
    if (m && m.index !== undefined) text = text.slice(0, m.index) + " " + text.slice(m.index + m[0].length);
    return m;
  };
  const n = wallOf(now, tz);

  const rel = take(/\bin\s+(\d+(?:\.\d+)?)\s*(minutes?|mins?|m|hours?|hrs?|h|days?|d|weeks?|w)\b/i);
  if (rel) {
    const v = Number(rel[1]);
    const u = (rel[2] ?? "m").toLowerCase()[0];
    const ms = u === "m" ? v * 60_000 : u === "h" ? v * 3_600_000 : u === "d" ? v * 86_400_000 : v * 604_800_000;
    if (!(v > 0) || ms > 366 * 86_400_000) return null;
    return { at: Math.round((now + ms) / 60_000) * 60_000, hasTime: true, rest: tidy(text) };
  }

  let date: { y: number; mo: number; d: number } | null = null;
  let m: RegExpMatchArray | null;
  const ymd = (y: number, mo: number, d: number) => (mo >= 1 && mo <= 12 && d >= 1 && d <= 31 ? { y, mo, d } : null);
  const future = (mo: number, d: number) => {
    let y = n.y;
    if (fromWall(y, mo, d, 23, 59, tz) < now) y += 1;
    return ymd(y, mo, d);
  };
  if ((m = take(/\b(\d{4})-(\d{1,2})-(\d{1,2})\b/))) date = ymd(Number(m[1]), Number(m[2]), Number(m[3]));
  else if ((m = take(new RegExp(`\\b${MON}\\s+(\\d{1,2})(?:st|nd|rd|th)?(?:,?\\s+(\\d{4}))?\\b`, "i")))) {
    const mo = MONTHS.indexOf((m[1] ?? "").toLowerCase()) + 1;
    date = m[3] ? ymd(Number(m[3]), mo, Number(m[2])) : future(mo, Number(m[2]));
  } else if ((m = take(new RegExp(`\\b(\\d{1,2})(?:st|nd|rd|th)?\\s+${MON}\\b`, "i")))) {
    date = future(MONTHS.indexOf((m[2] ?? "").toLowerCase()) + 1, Number(m[1]));
  } else if ((m = take(/\b(\d{1,2})\/(\d{1,2})(?:\/(\d{2,4}))?\b/))) {
    const yy = m[3] ? (m[3].length === 2 ? 2000 + Number(m[3]) : Number(m[3])) : 0;
    date = yy ? ymd(yy, Number(m[1]), Number(m[2])) : future(Number(m[1]), Number(m[2]));
  } else if (take(/\b(tomorrow|tmrw)\b/i)) {
    const t = wallOf(now + 86_400_000 + 3_600_000 * 0, tz);
    date = { y: t.y, mo: t.mo, d: t.d };
  } else if (take(/\b(today|tonight)\b/i)) date = { y: n.y, mo: n.mo, d: n.d };
  else if ((m = take(/\b(?:next\s+|this\s+|on\s+)?(sun|mon|tue|wed|thu|fri|sat)[a-z]*\b/i))) {
    const want = DAYS.indexOf((m[1] ?? "").toLowerCase());
    let ahead = (want - n.wd + 7) % 7;
    if (ahead === 0) ahead = 7;
    const t = wallOf(fromWall(n.y, n.mo, n.d, 12, 0, tz) + ahead * 86_400_000, tz);
    date = { y: t.y, mo: t.mo, d: t.d };
  }

  let time: { h: number; mi: number } | null = null;
  if ((m = take(/\b(?:at\s+)?(\d{1,2})(?::(\d{2}))?\s*(am|pm|a\.m\.|p\.m\.)(?!\w)/i))) {
    let h = Number(m[1]);
    const pm = (m[3] ?? "").toLowerCase().startsWith("p");
    if (h < 1 || h > 12) return null;
    h = (h % 12) + (pm ? 12 : 0);
    time = { h, mi: Number(m[2] ?? 0) };
  } else if ((m = take(/\b(?:at\s+)?([01]?\d|2[0-3]):([0-5]\d)\b/))) time = { h: Number(m[1]), mi: Number(m[2]) };
  else if (take(/\b(?:at\s+)?noon\b/i)) time = { h: 12, mi: 0 };
  else if (take(/\b(?:at\s+)?midnight\b/i)) time = { h: 0, mi: 0 };
  else if ((m = take(/\bat\s+(\d{1,2})\b(?!\s*(?:st|nd|rd|th|\/|:|-))/i))) {
    const h = Number(m[1]);
    if (h < 1 || h > 23) return null;
    time = { h: h <= 6 ? h + 12 : h, mi: 0 }; // "at 5" means 5pm; "at 9" means 9am
  }
  if (!date && !time) return null;
  if (m === null && /tonight/i.test(input) && !time) time = { h: 20, mi: 0 };

  const hasTime = !!time;
  const useTime = time ?? { h: defaultHour, mi: 0 };
  let day = date;
  if (!day) {
    day = { y: n.y, mo: n.mo, d: n.d };
    if (fromWall(day.y, day.mo, day.d, useTime.h, useTime.mi, tz) <= now) {
      const t = wallOf(fromWall(n.y, n.mo, n.d, 12, 0, tz) + 86_400_000, tz);
      day = { y: t.y, mo: t.mo, d: t.d };
    }
  }
  if (!day) return null;
  return { at: fromWall(day.y, day.mo, day.d, useTime.h, useTime.mi, tz), hasTime, rest: tidy(text) };
}

/** "for 1h", "90m", "1.5 hours". Returns minutes and the text without it. */
export function takeDuration(input: string): { minutes: number; rest: string } | null {
  const m = input.match(/(?<!\bin\s)\b(?:for\s+)?(\d+(?:\.\d+)?)\s*(hours?|hrs?|h|minutes?|mins?|m)\b(?!\s*(?:am|pm))/i);
  if (!m || m.index === undefined) return null;
  const v = Number(m[1]);
  const minutes = Math.round(/^h/i.test(m[2] ?? "") ? v * 60 : v);
  if (!(minutes >= 5 && minutes <= 24 * 60)) return null;
  return { minutes, rest: (input.slice(0, m.index) + " " + input.slice(m.index + m[0].length)).replace(/\s+/g, " ").trim() };
}

export function whenLabel(ms: number, tz: string, withTime = true): string {
  return new Intl.DateTimeFormat("en-US", { timeZone: tz, weekday: "short", month: "short", day: "numeric", ...(withTime ? { hour: "numeric", minute: "2-digit" } : {}) }).format(new Date(ms));
}

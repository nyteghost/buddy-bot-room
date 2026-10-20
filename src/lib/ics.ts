/** A small, dependency-free reader for iCalendar (.ics) feeds: events, all-day events and the common repeat rules. Pure. */
export type IcsEvent = { title: string; start: number; end: number; allDay: boolean; location: string };

const MAX_OCCURRENCES = 1500;

export function unfold(text: string): string[] {
  return text.replace(/\r\n?/g, "\n").replace(/\n[ \t]/g, "").split("\n");
}

type Prop = { name: string; params: Record<string, string>; value: string };
function parseLine(line: string): Prop | null {
  const colon = line.indexOf(":");
  if (colon < 1) return null;
  const [name = "", ...rest] = line.slice(0, colon).split(";");
  const params: Record<string, string> = {};
  for (const p of rest) { const [k = "", v = ""] = p.split("="); params[k.toUpperCase()] = v.replace(/^"|"$/g, ""); }
  return { name: name.toUpperCase(), params, value: line.slice(colon + 1) };
}
const unescapeText = (v: string): string => v.replace(/\\n/gi, " ").replace(/\\([,;\\])/g, "$1").trim();

/** Offset (ms) of a time zone from UTC at a given instant. */
function offsetMs(at: number, tz: string): number {
  const f = new Intl.DateTimeFormat("en-US", { timeZone: tz, hourCycle: "h23", year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", second: "2-digit" });
  const p: Record<string, number> = {};
  for (const x of f.formatToParts(new Date(at))) if (x.type !== "literal") p[x.type] = Number(x.value);
  return Date.UTC(p["year"] ?? 0, (p["month"] ?? 1) - 1, p["day"] ?? 1, p["hour"] ?? 0, p["minute"] ?? 0, p["second"] ?? 0) - Math.floor(at / 1000) * 1000;
}
const validTz = (tz: string | undefined): string | null => { if (!tz) return null; try { new Intl.DateTimeFormat("en-US", { timeZone: tz }); return tz; } catch { return null; } };

/** Wall-clock fields in a zone → the real instant (ms). */
export function wallToUtc(y: number, mo: number, d: number, h: number, mi: number, s: number, tz: string): number {
  const guess = Date.UTC(y, mo - 1, d, h, mi, s);
  let t = guess - offsetMs(guess, tz);
  t = guess - offsetMs(t, tz);
  return t;
}

type When = { y: number; mo: number; d: number; h: number; mi: number; s: number; utc: boolean; allDay: boolean; tz: string | null };
function parseWhen(p: Prop): When | null {
  const m = /^(\d{4})(\d\d)(\d\d)(?:T(\d\d)(\d\d)(\d\d)?(Z)?)?$/.exec(p.value.trim());
  if (!m) return null;
  const allDay = p.params["VALUE"] === "DATE" || m[4] === undefined;
  return { y: +(m[1] ?? 0), mo: +(m[2] ?? 1), d: +(m[3] ?? 1), h: +(m[4] ?? 0), mi: +(m[5] ?? 0), s: +(m[6] ?? 0), utc: m[7] === "Z", allDay, tz: validTz(p.params["TZID"]) };
}
const toMs = (w: When, fallbackTz: string): number => (w.utc ? Date.UTC(w.y, w.mo - 1, w.d, w.h, w.mi, w.s) : wallToUtc(w.y, w.mo, w.d, w.h, w.mi, w.s, w.allDay ? fallbackTz : (w.tz ?? fallbackTz)));

function parseDuration(v: string): number {
  const m = /^P(?:(\d+)W)?(?:(\d+)D)?(?:T(?:(\d+)H)?(?:(\d+)M)?(?:(\d+)S)?)?$/.exec(v.trim());
  return m ? (+(m[1] ?? 0) * 7 * 86400 + +(m[2] ?? 0) * 86400 + +(m[3] ?? 0) * 3600 + +(m[4] ?? 0) * 60 + +(m[5] ?? 0)) * 1000 : 0;
}

type Rule = { freq: string; interval: number; count: number; until: number | null; byday: number[]; bymonthday: number[] };
const DAYS = ["SU", "MO", "TU", "WE", "TH", "FR", "SA"];
function parseRule(v: string, fallbackTz: string): Rule | null {
  const o: Record<string, string> = {};
  for (const part of v.split(";")) { const [k = "", val = ""] = part.split("="); o[k.toUpperCase()] = val; }
  if (!["DAILY", "WEEKLY", "MONTHLY", "YEARLY"].includes(o["FREQ"] ?? "")) return null;
  const until = o["UNTIL"] ? parseWhen({ name: "UNTIL", params: {}, value: o["UNTIL"] }) : null;
  return {
    freq: o["FREQ"] ?? "", interval: Math.max(1, Number(o["INTERVAL"]) || 1), count: Number(o["COUNT"]) || 0,
    until: until ? (until.allDay ? Date.UTC(until.y, until.mo - 1, until.d, 23, 59, 59) : toMs(until, fallbackTz)) : null,
    byday: (o["BYDAY"] ?? "").split(",").map((d) => DAYS.indexOf(d.replace(/^[-+\d]+/, ""))).filter((n) => n >= 0),
    bymonthday: (o["BYMONTHDAY"] ?? "").split(",").map(Number).filter((n) => n >= 1 && n <= 31),
  };
}

/** Start times of every occurrence (wall-clock stepping, so a 9:00 meeting stays at 9:00 across daylight-saving changes). */
function occurrences(start: When, rule: Rule | null, from: number, to: number, fallbackTz: string): number[] {
  const tz = start.allDay ? fallbackTz : (start.utc ? "UTC" : (start.tz ?? fallbackTz));
  const at = (y: number, mo: number, d: number) => (start.utc ? Date.UTC(y, mo - 1, d, start.h, start.mi, start.s) : wallToUtc(y, mo, d, start.h, start.mi, start.s, tz));
  const first = at(start.y, start.mo, start.d);
  if (!rule) return [first];
  const out: number[] = [];
  let n = 0;
  const push = (t: number): boolean => {
    if (t < first) return true;
    if (rule.until !== null && t > rule.until) return false;
    n++;
    if (rule.count && n > rule.count) return false;
    if (t >= from - 86400000 * 2 && t <= to) out.push(t);
    return t <= to && n < MAX_OCCURRENCES;
  };
  const base = new Date(Date.UTC(start.y, start.mo - 1, start.d));
  for (let i = 0; i < MAX_OCCURRENCES; i++) {
    if (rule.freq === "DAILY") {
      const dt = new Date(base.getTime() + i * rule.interval * 86400000);
      if (!push(at(dt.getUTCFullYear(), dt.getUTCMonth() + 1, dt.getUTCDate()))) break;
    } else if (rule.freq === "WEEKLY") {
      const days = rule.byday.length ? rule.byday : [base.getUTCDay()];
      const weekStart = base.getTime() - base.getUTCDay() * 86400000 + i * rule.interval * 7 * 86400000;
      let go = true;
      for (const wd of [...days].sort((a, b) => a - b)) {
        const dt = new Date(weekStart + wd * 86400000);
        if (!push(at(dt.getUTCFullYear(), dt.getUTCMonth() + 1, dt.getUTCDate()))) { go = false; break; }
      }
      if (!go) break;
    } else if (rule.freq === "MONTHLY") {
      const mo = start.mo - 1 + i * rule.interval;
      const y = start.y + Math.floor(mo / 12);
      const m = ((mo % 12) + 12) % 12;
      const dim = new Date(Date.UTC(y, m + 1, 0)).getUTCDate();
      let go = true;
      for (const day of rule.bymonthday.length ? rule.bymonthday : [start.d]) {
        if (day > dim) continue;
        if (!push(at(y, m + 1, day))) { go = false; break; }
      }
      if (!go) break;
    } else {
      const y = start.y + i * rule.interval;
      if (!push(at(y, start.mo, Math.min(start.d, new Date(Date.UTC(y, start.mo, 0)).getUTCDate())))) break;
    }
  }
  return out;
}

/** Every event overlapping [from, to), in time order. `defaultTz` is used for floating times and all-day events. */
export function eventsInRange(text: string, from: number, to: number, defaultTz: string): IcsEvent[] {
  const tzDefault = validTz(defaultTz) ?? "UTC";
  const lines = unfold(text);
  type Raw = { props: Prop[] };
  const events: Raw[] = [];
  let cur: Raw | null = null;
  for (const line of lines) {
    if (line === "BEGIN:VEVENT") cur = { props: [] };
    else if (line === "END:VEVENT") { if (cur) events.push(cur); cur = null; }
    else if (cur) { const p = parseLine(line); if (p) cur.props.push(p); }
  }
  const get = (e: Raw, n: string) => e.props.find((p) => p.name === n);
  const all = (e: Raw, n: string) => e.props.filter((p) => p.name === n);
  const overridden = new Set<string>();
  for (const e of events) {
    const rid = get(e, "RECURRENCE-ID");
    const uid = get(e, "UID")?.value;
    const w = rid ? parseWhen(rid) : null;
    if (w && uid) overridden.add(`${uid}|${toMs(w, tzDefault)}`);
  }
  const out: IcsEvent[] = [];
  for (const e of events) {
    if (get(e, "STATUS")?.value.toUpperCase() === "CANCELLED") continue;
    const ds = get(e, "DTSTART");
    const start = ds ? parseWhen(ds) : null;
    if (!start) continue;
    const de = get(e, "DTEND");
    const endW = de ? parseWhen(de) : null;
    const startMs = toMs(start, tzDefault);
    const dur = endW ? Math.max(0, toMs(endW, tzDefault) - startMs) : get(e, "DURATION") ? parseDuration(get(e, "DURATION")?.value ?? "") : start.allDay ? 86400000 : 0;
    const rule = get(e, "RRULE") ? parseRule(get(e, "RRULE")?.value ?? "", tzDefault) : null;
    const skip = new Set<number>();
    for (const x of all(e, "EXDATE")) for (const v of x.value.split(",")) { const w = parseWhen({ ...x, value: v }); if (w) skip.add(toMs(w, tzDefault)); }
    const uid = get(e, "UID")?.value;
    const title = unescapeText(get(e, "SUMMARY")?.value ?? "") || "(no title)";
    const location = unescapeText(get(e, "LOCATION")?.value ?? "").slice(0, 80);
    for (const t of occurrences(start, rule, from, to, tzDefault)) {
      if (skip.has(t) || (!get(e, "RECURRENCE-ID") && uid && overridden.has(`${uid}|${t}`))) continue;
      const end = t + dur;
      if (end > from && t < to) out.push({ title: title.slice(0, 120), start: t, end, allDay: start.allDay, location });
      else if (dur === 0 && t >= from && t < to) out.push({ title: title.slice(0, 120), start: t, end: t, allDay: start.allDay, location });
    }
  }
  return out.sort((a, b) => a.start - b.start || a.title.localeCompare(b.title));
}

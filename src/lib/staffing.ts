// Coverage-based staffing suggestions for the show service team. Pure functions, no React.
// Rules: at least 1 engineer for any show, at least 2 at all times for a big show (2+ halls) on the days it is here.
import { formatMinutes, parseShift, type EventEntry } from "./work-tools";

export type Staff = { name: string; badge: string; title: string; patterns?: { start: number; end: number }[]; offWeekdays?: number[]; baseline?: { weekdays: number[]; pattern: { start: number; end: number } }; lastResort?: number[]; powerDays?: number[]; /** Never the only engineer on during a show. */ notAlone?: boolean };
const hours = (list: [number, number][]) => list.map(([a, b]) => ({ start: a * 60, end: b * 60 }));
const EVENING = hours([[12, 20.5], [12.5, 21], [13, 21.5], [13.5, 22], [14, 22.5], [14.5, 23], [15, 23.5], [15.5, 24]]);
export const SHOW_STAFF: Staff[] = [
  { name: "Madjid Lakhdari", badge: "604", title: "Show Srvc Supervisor", patterns: hours([[6, 14.5]]), offWeekdays: [1, 2], powerDays: [1, 2], baseline: { weekdays: [0, 3, 4, 5, 6], pattern: { start: 360, end: 870 } } }, // always 6a-2:30p, off Tue and Wed
  { name: "Alemneh Teshome", badge: "608", title: "Show Srvc Eng", patterns: hours([[7, 15.5]]), baseline: { weekdays: [1, 2, 3, 4, 5], pattern: { start: 420, end: 930 } }, lastResort: [0, 6] }, // Tue-Sat 7a-3:30p; Mon or Sun only if really needed
  { name: "Alexis Albert", badge: "606", title: "Show Srvc Supervisor", patterns: hours([[7, 15.5], [8, 16.5], [9, 17.5]]) }, // only 7a-3:30p, 8a-4:30p or 9a-5:30p
  { name: "Edison Dunkley", badge: "605", title: "Show Srvc Supervisor", patterns: [...EVENING, ...hours([[16.5, 25], [19.5, 28]])], lastResort: [0, 1] }, // 12p-8:30p up to 3:30p-12a; takes the 1a / 4a close shifts; Mon and Tue off when possible
  { name: "Franck Pierre-Louis", badge: "607", title: "Show Srvc Eng", patterns: EVENING, notAlone: true }, // 12p-8:30p up to 3:30p-12a; never works a show alone (until told otherwise)
];
export const ON_CALL: Staff = { name: "Jontee King", badge: "On-Call", title: "On-Call Show Srvc Eng", patterns: hours([[17, 22], [17, 23], [17, 24]]) }; // only 5p-10p, 5p-11p or 5p-12a
export const OPS_ASSISTANT = { name: "Jacquline Dixon", badge: "615", title: "Ops Assistant" };
/** Shows heavy on power (lots of 60 / 30 amp orders): Madjid works Tue and Wed for these. */
export const POWER_HEAVY = /gordon|c-?store|convenience/i;
/** Monday = 0 … Sunday = 6 */
const weekday = (iso: string) => (new Date(`${iso}T12:00:00Z`).getUTCDay() + 6) % 7;

/** Standard shift patterns (start, end in minutes). */
export const PATTERNS: { start: number; end: number }[] = [
  [6, 14.5], [7, 15.5], [8, 16.5], [9, 18], [10, 18.5], [12, 20.5], [14, 22.5], [15, 23.5],
].map(([a, b]) => ({ start: a! * 60, end: b! * 60 }));
export const MAX_DAYS = 5;
const SLOTS = 56; // half hours from midnight to 4a the next morning
type Shift = { name: string; start: number; end: number };
const aloneOnly = (name: string) => !!SHOW_STAFF.find((x) => x.name === name)?.notAlone;
/** People on per half hour, where someone who must not work alone only counts when another engineer is on with them. */
const effCover = (list: Shift[]): number[] => {
  const others = new Array<number>(SLOTS).fill(0), na = new Array<number>(SLOTS).fill(0);
  for (const a of list) for (let i = 0; i < SLOTS; i++) if (a.start < (i + 1) * 30 && a.end > i * 30) (aloneOnly(a.name) ? na : others)[i]!++;
  return others.map((o, i) => o + (o > 0 ? na[i]! : 0));
};
const othersAt = (list: Shift[]): number[] => { const o = new Array<number>(SLOTS).fill(0); for (const a of list) if (!aloneOnly(a.name)) for (let i = 0; i < SLOTS; i++) if (a.start < (i + 1) * 30 && a.end > i * 30) o[i]!++; return o; };
// An end before the start means it runs past midnight; an end equal to the start is a point in time (e.g. a 7:30a move-in marker), worth half an hour, not a whole day.
const endOf = (e: EventEntry) => (e.end < e.start ? e.end + 1440 : e.end === e.start ? e.end + 30 : e.end);

/** Air wall work always needs at least 2 people for its window. */
export type Hold = { date: string; start: number; end: number; n: number; text: string };
/** Length of an air wall job for 2 people: ballroom walls go quickly (about 20 min a wall, 90 at most); a hall wall takes at least 90 min. */
export function airwallMinutes(section: string, text: string): number {
  const walls = Math.max(1, spacesOf(section, text).length - 1);
  return section === "HALLS" ? 90 * walls : Math.min(90, Math.max(20, 20 * walls));
}
const spacesOf = (section: string, text: string): string[] => {
  if (/full ballroom/i.test(text)) return "ABCDEFG".split("").map((c) => `BallRoom ${c}`);
  const letters = new Set(text.replace(/make|hall|ballroom/gi, "").replace(/[^A-G]/g, "").split(""));
  return [...letters].filter(Boolean).sort().map((c) => `${section === "HALLS" ? "Hall" : "BallRoom"} ${c}`);
};
/** When an air wall job can start: 30-90 min after a ballroom move-out begins, right after a show ends, or mid-morning when the rooms are unused that day. */
export function airwallStart(task: { date: string; section: string; text: string }, entries: EventEntry[]): { start: number; latest: number; why: string } {
  const sp = spacesOf(task.section, task.text);
  const use = entries.filter((e) => e.date === task.date && sp.includes(e.space) && e.code !== "MO?");
  if (!use.length) return { start: 8 * 60, latest: 8 * 60, why: "Rooms are not used that day, so any time; mid-morning default." };
  const last = use.reduce((a, b) => (endOf(b) > endOf(a) ? b : a));
  const mo = use.filter((e) => e.code === "MO");
  if (mo.length && endOf(last) === Math.max(...mo.map(endOf))) {
    const m = Math.min(...mo.map((e) => e.start));
    return { start: m + 30, latest: m + 90, why: `Move out starts ${formatMinutes(m)}; the walls can go in 30-90 min after that.` };
  }
  return { start: endOf(last), latest: endOf(last), why: `Rooms are in use until ${formatMinutes(endOf(last))}.` };
}
export function airwallHolds(tasks: { date: string; section: string; text: string }[], entries: EventEntry[]): Hold[] {
  return tasks.filter((t) => /^make /i.test(t.text)).map((t) => { const w = airwallStart(t, entries); return { date: t.date, start: w.start, end: w.start + airwallMinutes(t.section, t.text), n: 2, text: t.text }; });
}

export type Avail = { off: boolean; fixed?: { start: number; end: number } };
export type DayPlan = {
  date: string;
  need: number[]; // required people per half hour
  assignments: { name: string; start: number; end: number; fixed: boolean; reason: string }[];
  notUsed: { name: string; why: string }[];
  notes: string[];
  gaps: { start: number; end: number; short: number }[];
  desk: { name: string; start: number; end: number; reason: string } | null; // Ops Assistant on Service Desk hours; not counted as coverage
};

const label = (m: number) => formatMinutes(m);
export const shiftText = (a: { start: number; end: number }) => `${label(a.start)}-${label(a.end)}`;

/** People needed per half hour on one day. */
export function dayNeed(entries: EventEntry[], date: string): number[] {
  const need = new Array<number>(SLOTS).fill(0);
  const day = entries.filter((e) => e.date === date && e.code !== "MO?");
  const mark = (start: number, end: number, n: number) => {
    const e = Math.max(end, start + 1);
    for (let i = 0; i < SLOTS; i++) if (start < (i + 1) * 30 && e > i * 30) need[i] = Math.max(need[i]!, n);
  };
  for (const e of day) mark(e.start, e.code === "Arr" ? e.start + 30 : endOf(e), 1);
  // A big show (2+ halls) needs two people for the whole stretch it is here that day.
  const byEvent = new Map<string, EventEntry[]>();
  for (const e of day) byEvent.set(e.eventId ?? e.title, [...(byEvent.get(e.eventId ?? e.title) ?? []), e]);
  for (const list of byEvent.values()) {
    const halls = new Set(list.filter((e) => /^Hall /.test(e.space)).map((e) => e.space));
    if (halls.size >= 2) mark(Math.min(...list.map((e) => e.start)), Math.max(...list.map((e) => (e.code === "Arr" ? e.start + 30 : endOf(e)))), 2);
  }
  return need;
}

/** Half hours where a medium show (2+ spaces, but not a big one) is here. */
export function mediumSlots(entries: EventEntry[], date: string): boolean[] {
  const out = new Array<boolean>(SLOTS).fill(false);
  const byEvent = new Map<string, EventEntry[]>();
  for (const e of entries.filter((x) => x.date === date && x.code !== "MO?")) byEvent.set(e.eventId ?? e.title, [...(byEvent.get(e.eventId ?? e.title) ?? []), e]);
  for (const list of byEvent.values()) {
    if (new Set(list.filter((e) => /^Hall /.test(e.space)).map((e) => e.space)).size >= 2) continue; // big
    if (new Set(list.map((e) => e.space)).size < 2) continue; // small
    const a = Math.min(...list.map((e) => e.start)), b = Math.max(...list.map(endOf));
    for (let i = 0; i < SLOTS; i++) if (a < (i + 1) * 30 && b > i * 30) out[i] = true;
  }
  return out;
}
const range = (slots: number[]) => {
  const parts: string[] = [];
  let i = 0;
  while (i < slots.length) { let j = i; while (j + 1 < slots.length && slots[j + 1] === slots[j]! + 1) j++; parts.push(`${label(slots[i]! * 30)}-${label((slots[j]! + 1) * 30)}`); i = j + 1; }
  return parts.join(", ");
};

/** Fills each day's needs from the staff, keeping fixed shifts and days off, 5 working days each. */
export function planWeek(
  dates: string[], entries: EventEntry[], staff: Staff[] = SHOW_STAFF, avail: Record<string, Record<string, Avail>> = {}, onCall: Staff | null = ON_CALL, holds: Hold[] = [],
): DayPlan[] {
  const worked = new Map<string, number>(staff.map((s) => [s.name, 0]));
  const days = new Map<string, Set<string>>(staff.map((s) => [s.name, new Set()]));
  const prevDay = (d: string) => new Date(new Date(`${d}T12:00:00Z`).getTime() - 864e5).toISOString().slice(0, 10);
  for (const s of staff) for (const d of dates) if (avail[s.name]?.[d]?.fixed || avail[s.name]?.[d]?.off) worked.set(s.name, worked.get(s.name)! + 1); // paid leave counts as one of the 5 days
  const plans: DayPlan[] = [];
  for (const date of dates) {
    const need = dayNeed(entries, date);
    for (const h of holds) if (h.date === date) for (let i = 0; i < SLOTS; i++) if (h.start < (i + 1) * 30 && h.end > i * 30) need[i] = Math.max(need[i]!, h.n);
    const day = entries.filter((e) => e.date === date && e.code !== "MO?");
    const medium = mediumSlots(entries, date);
    const powerDay = day.some((e) => POWER_HEAVY.test(e.title));
    const offDay = (m: Staff) => !!m.offWeekdays?.includes(weekday(date)) && !(powerDay && m.powerDays?.includes(weekday(date)));
    const notes: string[] = [];
    const assignments: DayPlan["assignments"] = [];
    const busy = new Set<string>();
    const add = (name: string, start: number, end: number, fixed: boolean, reason: string) => {
      assignments.push({ name, start, end, fixed, reason });
      days.get(name)?.add(date);
      busy.add(name);
    };
    const coverNote = (p: { start: number; end: number }) => {
      const hit = day.filter((e) => e.start < p.end && e.end > p.start).map((e) => e.title);
      return hit.length ? `Overlaps ${[...new Set(hit)].slice(0, 4).join(", ")}.` : "No show overlaps this shift.";
    };
    for (const s of staff) { const f = avail[s.name]?.[date]?.fixed; if (f) add(s.name, f.start, f.end, true, "Shift already entered in your workbook, kept as is."); }
    // Usual lines first: they work them whether or not a show needs them.
    for (const s of staff) {
      const b = s.baseline;
      if (b && (b.weekdays.includes(weekday(date)) || (powerDay && s.powerDays?.includes(weekday(date)))) && !busy.has(s.name) && !avail[s.name]?.[date]?.off) {
        add(s.name, b.pattern.start, b.pattern.end, false, `Usual line (${shiftText(b.pattern)}, ${b.weekdays.length} days a week): works it whether or not a show needs them. ${powerDay && !b.weekdays.includes(weekday(date)) ? "Normally off, but this is a power-heavy show (Gordon / C-store type). " : ""}${coverNote(b.pattern)}`);
        worked.set(s.name, worked.get(s.name)! + 1);
      }
    }
    const cover = () => effCover(assignments);
    const deficit = () => { const c = cover(); return need.map((n, i) => Math.max(0, n - c[i]!)); };
    // Pass -1 first covers anything running past midnight (only the late blocks can), then the rest of the day.
    const banned = new Set<string>(); // someone who must not work alone, dropped from today because that is what the shift would do
    const cover1 = () => {
    for (let pass = -1; pass < 2; pass++) for (;;) {
      const def = deficit().map((x, i) => (pass < 0 && i < 48 ? 0 : x));
      if (!def.some((x) => x > 0)) break;
      const oth = othersAt(assignments);
      let best: { name: string; p: { start: number; end: number }; gain: number; waste: number; adj: number } | null = null;
      for (const s of staff) {
        const wd = weekday(date);
        const lastResort = !!s.lastResort?.includes(wd);
        if (busy.has(s.name) || banned.has(s.name) || avail[s.name]?.[date]?.off || offDay(s)) continue;
        if (s.baseline && !s.baseline.weekdays.includes(wd) && !lastResort) continue; // only works their usual days
        if (lastResort && pass <= 0) continue; // Mon/Sun only when nobody else can cover it
        if (worked.get(s.name)! >= MAX_DAYS) continue; // 5 days is firm, even for a last-resort day
        for (const p of s.patterns ?? PATTERNS) {
          let gain = 0;
          for (let i = 0; i < SLOTS; i++) if (def[i]! > 0 && p.start < (i + 1) * 30 && p.end > i * 30 && (!s.notAlone || oth[i]! > 0)) gain++;
          const waste = (p.end - p.start) / 30 - gain;
          const adj = days.get(s.name)!.has(prevDay(date)) ? 1 : 0; // keeps work days together so days off land together
          const better = !best || gain > best.gain || (gain === best.gain && waste < best.waste) || (gain === best.gain && waste === best.waste && (adj > best.adj || (adj === best.adj && worked.get(s.name)! < worked.get(best.name)!)));
          if (gain > 0 && better) best = { name: s.name, p, gain, waste, adj };
        }
      }
      if (!best) break;
      {
        const slots = def.map((x, i) => (x > 0 && best!.p.start < (i + 1) * 30 && best!.p.end > i * 30 ? i : -1)).filter((i) => i >= 0);
        const why = (staff.find((x) => x.name === best!.name)?.lastResort?.includes(weekday(date)))
          ? `${["Mon","Tue","Wed","Thu","Fri","Sat","Sun"][weekday(date)]} is normally off (or only if needed), and nobody else could cover ${range(slots)}, so this is the exception. `
          : "";
        add(best.name, best.p.start, best.p.end, false, `${why}Still short ${range(slots)} (need ${Math.max(...slots.map((i) => need[i]!))}, had ${Math.min(...slots.map((i) => cover()[i]!))}). ${shiftText(best.p)} closes the most of that gap (${slots.length / 2}h); ${best.name.split(" ")[0]} has worked ${worked.get(best.name)} day(s) so far this week. ${coverNote(best.p)}`);
      }
      worked.set(best.name, worked.get(best.name)! + 1);
    }
    };
    cover1();
    // Someone who must not work alone is dropped if any show hour of their shift would have them by themselves, then coverage is retried without them.
    for (let attempt = 0; attempt < 3; attempt++) {
      const oth = othersAt(assignments);
      const lone = assignments.filter((a) => aloneOnly(a.name) && !a.fixed && need.some((n, i) => n > 0 && oth[i] === 0 && a.start < (i + 1) * 30 && a.end > i * 30));
      if (!lone.length) break;
      for (const a of lone) {
        assignments.splice(assignments.indexOf(a), 1);
        days.get(a.name)?.delete(date); busy.delete(a.name); banned.add(a.name);
        worked.set(a.name, Math.max(0, worked.get(a.name)! - 1));
      }
      cover1();
    }
    // Jontee is never scheduled automatically. He is suggested only for a busy evening that is still short
    // on a day Edison or Franck is off; the person decides.
    if (onCall) {
      const left = deficit();
      const worksToday = (n: string) => assignments.some((a) => a.name === n);
      const someoneOff = ["Edison Dunkley", "Franck Pierre-Louis"].filter((n) => !worksToday(n));
      let pick: { start: number; end: number } | null = null, top = 0;
      for (const p of onCall.patterns ?? []) {
        let gain = 0;
        for (let i = 34; i < SLOTS; i++) if (left[i]! > 0 && p.start < (i + 1) * 30 && p.end > i * 30) gain++;
        if (gain > top) { top = gain; pick = p; }
      }
      if (pick && someoneOff.length && !avail[onCall.name]?.[date]?.off) notes.push(`Suggestion: ${onCall.name.split(" ")[0]} ${shiftText(pick)} would close the evening gap (${someoneOff.map((n) => n.split(" ")[0]).join(" and ")} off today). Not scheduled.`);
    }
    const notUsed: DayPlan["notUsed"] = [];
    for (const m of [...staff, ...(onCall ? [onCall] : [])]) {
      if (busy.has(m.name)) continue;
      const wd = weekday(date);
      notUsed.push({ name: m.name, why: avail[m.name]?.[date]?.off ? "Marked off in the workbook." : offDay(m) ? "Always off this day." : m === onCall ? "On-call: never scheduled automatically; suggested in the notes when an evening is short." : m.lastResort?.includes(wd) ? "Normally off this day; no absolute need." : m.baseline && !m.baseline.weekdays.includes(wd) ? "Not one of their usual days." : worked.get(m.name)! >= MAX_DAYS ? `Already at ${MAX_DAYS} days this week.` : "Not needed: coverage was already met." });
    }
    const gaps: DayPlan["gaps"] = [];
    const def = deficit();
    for (let i = 0; i < SLOTS; i++) {
      if (!def[i]) continue;
      const last = gaps[gaps.length - 1];
      if (last && last.end === i * 30 && last.short === def[i]) last.end = (i + 1) * 30;
      else gaps.push({ start: i * 30, end: (i + 1) * 30, short: def[i]! });
    }
    if (gaps.length) notes.push(`Short-staffed ${gaps.map((g) => `${shiftText(g)} (${g.short} more)`).join(", ")}: nobody left who can legally or sensibly cover it.`);
    const exmi = entries.filter((e) => e.date === date && e.code === "Exmi");
    const off = avail[OPS_ASSISTANT.name]?.[date]?.off;
    const desk = off ? null
      : exmi.length ? { name: OPS_ASSISTANT.name, start: Math.min(...exmi.map((e) => e.start)), end: Math.max(...exmi.map((e) => e.end)), reason: "Works the Service Desk / Exhibitor Services hours when the desk is open; does not count toward engineer coverage." }
      : weekday(date) <= 4 ? { name: OPS_ASSISTANT.name, start: 420, end: 930, reason: "No Service Desk that day, so her regular Mon-Fri 7a-3:30p; does not count toward engineer coverage." }
      : null;
    plans.push({ date, need, desk, assignments: assignments.sort((a, b) => a.start - b.start), notUsed, notes, gaps });
  }
  return plans;
}

/** Hours on the clock: a scheduled 8.5 hour shift is 8 worked because of lunch. */
export const workedHours = (a: { start: number; end: number }) => (a.end - a.start === 510 ? 8 : (a.end - a.start) / 60);

/** "2: 6a-11p, 1: 11p-12a" style summary of a day's needs. */
export function needText(need: number[]): string {
  const parts: string[] = [];
  let i = 0;
  while (i < SLOTS) {
    const n = need[i]!;
    let j = i;
    while (j < SLOTS && need[j] === n) j++;
    if (n > 0) parts.push(`${n}: ${label(i * 30)}-${label(j * 30)}`);
    i = j;
  }
  return parts.join(", ");
}

/** Reads a workbook cell like "7a-3:30p" as a fixed shift, "OFF"/"PTO" as unavailable, anything else as free. */
export function readAvail(text: string): Avail | null {
  const t = text.trim();
  if (!t) return null;
  if (/^off$/i.test(t)) return null; // OFF is what the planner writes for a day not worked; only PTO-type entries block a day
  if (/^(pto|sick|vac|fmla|bereave|holiday)/i.test(t)) return { off: true };
  const s = parseShift(t.split("\n")[0] ?? "");
  return s ? { off: false, fixed: { start: s.start, end: s.end } } : null;
}

export const WEEK_HOURS = 40;
const isOffDay = (m: Staff, date: string, entries: EventEntry[]) => {
  const powerDay = entries.some((e) => e.date === date && e.code !== "MO?" && POWER_HEAVY.test(e.title));
  return !!m.offWeekdays?.includes(weekday(date)) && !(powerDay && m.powerDays?.includes(weekday(date)));
};
const combos = <T,>(list: T[], k: number): T[][] => (k <= 0 ? [[]] : list.flatMap((x, i) => combos(list.slice(i + 1), k - 1).map((rest) => [x, ...rest])));
const coverOf = (p: DayPlan) => effCover(p.assignments);
const gapsOf = (p: DayPlan): DayPlan["gaps"] => {
  const cover = coverOf(p), out: DayPlan["gaps"] = [];
  for (let i = 0; i < SLOTS; i++) {
    const short = Math.max(0, p.need[i]! - cover[i]!);
    if (!short) continue;
    const last = out[out.length - 1];
    if (last && last.end === i * 30 && last.short === short) last.end = (i + 1) * 30; else out.push({ start: i * 30, end: (i + 1) * 30, short });
  }
  return out;
};

/**
 * Nobody works more than 5 days a week (paid leave counts as a day). If coverage or a power-heavy show pushed someone past 5, a day that
 * can go without leaving a new gap is released, keeping two days off together where possible.
 */
function trimToFive(plans: DayPlan[], staff: Staff[], avail: Record<string, Record<string, Avail>>) {
  for (const s of staff) {
    for (;;) {
      const leave = plans.map((p) => !!avail[s.name]?.[p.date]?.off);
      const on = plans.map((p) => p.assignments.some((a) => a.name === s.name));
      if (on.filter(Boolean).length + leave.filter(Boolean).length <= MAX_DAYS) break;
      const short = (p: DayPlan, without: boolean) => { const c = effCover(p.assignments.filter((a) => !(without && a.name === s.name))); return p.need.reduce((t, n, i) => t + Math.max(0, n - c[i]!), 0); };
      let best: { i: number; score: number } | null = null;
      plans.forEach((p, i) => {
        if (!on[i] || p.assignments.some((a) => a.name === s.name && a.fixed)) return;
        if (short(p, true) > short(p, false)) return; // would open a gap
        const busy = plans.map((_, j) => (j !== i && (on[j] || leave[j])));
        const pair = busy.some((b, j) => !b && !busy[(j + 1) % 7]);
        const score = (pair ? 0 : 50) + plans[i]!.need.filter((n) => n > 0).length / 20 + (s.baseline && !s.baseline.weekdays.includes(weekday(p.date)) ? 20 : 0);
        if (!best || score < best.score) best = { i, score };
      });
      if (!best) { plans[6]!.notes.push(`${s.name.split(" ")[0]} works more than ${MAX_DAYS} days this week: every one of those days is needed for coverage.`); break; }
      const p = plans[(best as { i: number }).i]!;
      p.assignments = p.assignments.filter((a) => a.name !== s.name);
      p.notUsed.push({ name: s.name, why: `Kept to ${MAX_DAYS} days this week: this day was not needed for coverage.` });
    }
  }
}

/**
 * Everyone needs 40 hours a week, show or no show. After coverage is planned, anyone under 40 (paid leave and holidays count as 8)
 * gets extra shifts on their usual days, keeping two days off in a row and avoiding the days they are normally off.
 */
function topUp(plans: DayPlan[], staff: Staff[], avail: Record<string, Record<string, Avail>>, entries: EventEntry[]) {
  for (const s of staff) {
    const mine = (p: DayPlan) => p.assignments.filter((a) => a.name === s.name).reduce((t, a) => t + workedHours(a), 0);
    const leave = plans.map((p) => (avail[s.name]?.[p.date]?.off ? 8 : 0));
    const have = plans.map((p, i) => mine(p) + leave[i]!);
    const total = have.reduce((a, b) => a + b, 0);
    if (total >= WEEK_HOURS) continue;
    const cand = plans.map((p, i) => i).filter((i) => {
      const wd = weekday(plans[i]!.date);
      return have[i] === 0 && !avail[s.name]?.[plans[i]!.date]?.off && !isOffDay(s, plans[i]!.date, entries) && (!s.baseline || s.baseline.weekdays.includes(wd) || !!s.lastResort?.includes(wd)) && (!s.notAlone || (s.patterns ?? PATTERNS).some((pat) => !leavesAlone(plans[i]!, pat)));
    });
    const k = Math.min(cand.length, Math.ceil((WEEK_HOURS - total) / 8));
    if (k <= 0) continue;
    let best: { pick: number[]; score: number } | null = null;
    for (const pick of combos(cand, k)) {
      const busy = plans.map((_, i) => have[i]! > 0 || pick.includes(i));
      const offs = busy.filter((b) => !b).length;
      const pairOff = busy.some((b, i) => !b && !busy[(i + 1) % 7]);
      let score = offs >= 2 && !pairOff ? 60 : 0;
      for (const i of pick) {
        const wd = weekday(plans[i]!.date);
        if (s.lastResort?.includes(wd)) score += 100;
        if ((i > 0 && have[i - 1]! > 0) || (i < 6 && have[i + 1]! > 0)) score -= 2; // keeps work days together
        score -= plans[i]!.need.filter((n) => n > 0).length / 20; // lean toward the busier days
      }
      if (!best || score < best.score - 1e-9) best = { pick, score };
    }
    if (!best) continue;
    let running = total;
    for (const i of best.pick.sort((a, b) => a - b)) {
      const p = plans[i]!;
      const cover = coverOf(p);
      const pats = s.patterns ?? PATTERNS;
      let choice = pats[0]!, top = -1, waste = Infinity;
      for (const pat of pats) {
        if (s.notAlone && leavesAlone(p, pat)) continue;
        let gain = 0;
        for (let j = 0; j < SLOTS; j++) if (p.need[j]! > cover[j]! && pat.start < (j + 1) * 30 && pat.end > j * 30) gain++;
        const w = (pat.end - pat.start) / 30 - gain;
        if (gain > top || (gain === top && w < waste)) { top = gain; waste = w; choice = pat; }
      }
      running += workedHours(choice);
      p.assignments.push({ name: s.name, start: choice.start, end: choice.end, fixed: false, reason: `Hours top-up: nothing more was needed for coverage ${top > 0 ? "(this also closes part of a gap)" : "this day"}, but everyone needs ${WEEK_HOURS} hours a week. ${s.name.split(" ")[0]} had ${total} hours (paid leave counts as 8), so this ${shiftText(choice)} shift brings the week to ${Math.min(running, WEEK_HOURS + 8)}. Picked ${weekdayName(p.date)} so the days off stay together${s.lastResort?.includes(weekday(p.date)) ? ", though it is normally a day off for them" : ""}.` });
      p.assignments.sort((a, b) => a.start - b.start);
      p.notUsed = p.notUsed.filter((n) => n.name !== s.name);
      p.gaps = gapsOf(p);
      p.notes = p.notes.filter((n) => !n.startsWith("Short-staffed"));
      if (p.gaps.length) p.notes.push(`Short-staffed ${p.gaps.map((g) => `${shiftText(g)} (${g.short} more)`).join(", ")}: nobody left who can legally or sensibly cover it.`);
    }
    if (running < WEEK_HOURS) plans[6]!.notes.push(`${s.name.split(" ")[0]} only reaches ${running} hours this week: no allowed day was left (usual days, PTO or days off).`);
  }
}
/** True when this shift would leave someone who must not work alone on by themselves during a show. */
const leavesAlone = (p: DayPlan, pat: { start: number; end: number }) => { const o = othersAt(p.assignments); for (let j = 0; j < SLOTS; j++) if (p.need[j]! > 0 && o[j] === 0 && pat.start < (j + 1) * 30 && pat.end > j * 30) return true; return false; };
const weekdayName = (d: string) => ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"][weekday(d)]!;

/**
 * Jacquline works Service Desk hours, or Mon-Fri 7a-3:30p when there is no desk; never a weekend without the desk. She is kept to 5 days
 * (a plain weekday is released when a desk day pushes her past 5) and 40 hours (a short desk day is extended to a full shift when needed).
 */
function topUpDesk(plans: DayPlan[], avail: Record<string, Record<string, Avail>>) {
  const name = OPS_ASSISTANT.name;
  const leave = plans.map((p) => !!avail[name]?.[p.date]?.off);
  const days = () => plans.map((p, i) => !!p.desk || leave[i]!);
  const plain = (p: DayPlan) => !!p.desk && weekday(p.date) <= 4 && /regular Mon-Fri/.test(p.desk.reason);
  while (days().filter(Boolean).length > MAX_DAYS) {
    const cand = plans.map((p, i) => i).filter((i) => plain(plans[i]!));
    if (!cand.length) { plans[6]!.notes.push("Jacquline works more than 5 days this week: every day is a Service Desk day."); break; }
    let best = cand[0]!, top = Infinity;
    for (const i of cand) {
      const busy = days().map((b, j) => (j === i ? false : b));
      const score = (busy.some((b, j) => !b && !busy[(j + 1) % 7]) ? 0 : 50) + i * 0.01;
      if (score < top) { top = score; best = i; }
    }
    const p = plans[best]!;
    p.notUsed.push({ name, why: "Kept to 5 days: a Service Desk day pushed her past 5, so a plain weekday is off." });
    p.desk = null;
  }
  const hrs = (p: DayPlan) => (p.desk ? workedHours(p.desk) : 0);
  let total = leave.reduce((t, l) => t + (l ? 8 : 0), 0) + plans.reduce((t, p) => t + hrs(p), 0);
  const order = [...plans.keys()].sort((a, b) => (weekday(plans[a]!.date) > 4 ? 1 : 0) - (weekday(plans[b]!.date) > 4 ? 1 : 0));
  for (const i of order) {
    if (total >= WEEK_HOURS) break;
    const p = plans[i]!, d = p.desk;
    if (!d || d.end - d.start >= 510) continue;
    const start = Math.max(360, d.end - 510), end = Math.max(d.end, start + 510);
    const before = hrs(p);
    p.desk = { ...d, start, end, reason: `${d.reason} Extended to ${shiftText({ start, end })} so she reaches ${WEEK_HOURS} hours this week.` };
    total += hrs(p) - before;
  }
  if (total < WEEK_HOURS) plans[6]!.notes.push(`Jacquline only reaches ${total} hours this week from her Service Desk / Mon-Fri hours.`);
}

/** Plans whole Mon-Sun weeks (so the five-day limit and days off are per week) and notes anyone without two days off in a row. */
export function planWeeks(dates: string[], entries: EventEntry[], avail: Record<string, Record<string, Avail>> = {}, staff: Staff[] = SHOW_STAFF, holds: Hold[] = []): DayPlan[] {
  const mondays = [...new Set(dates.map((d) => { const t = new Date(`${d}T12:00:00Z`); t.setUTCDate(t.getUTCDate() - weekday(d)); return t.toISOString().slice(0, 10); }))].sort();
  const out: DayPlan[] = [];
  for (const m of mondays) {
    const week = Array.from({ length: 7 }, (_, i) => { const t = new Date(`${m}T12:00:00Z`); t.setUTCDate(t.getUTCDate() + i); return t.toISOString().slice(0, 10); });
    const plans = planWeek(week, entries, staff, avail, ON_CALL, holds);
    trimToFive(plans, staff, avail);
    topUp(plans, staff, avail, entries);
    topUpDesk(plans, avail);
    for (const s of staff) {
      const on = plans.map((p) => p.assignments.some((a) => a.name === s.name));
      if (!on.some(Boolean)) continue;
      const pairOff = on.some((x, i) => !x && !on[(i + 1) % 7]); // Sunday + the following Monday count as a pair
      if (!pairOff) plans[6]!.notes.push(`${s.name.split(" ")[0]} has no two days off in a row this week (coverage needed it).`);
    }
    out.push(...plans);
  }
  return out;
}

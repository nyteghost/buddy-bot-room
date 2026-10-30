// Browser-safe helpers for Mark's show-services work tools.

export const DEFAULT_SCHEDULE_NAME = "Mark Brown";
export const TIME_ZONE = "America/New_York";

// ---------- time parsing ----------
/** "9a" → 540, "4:30" (no suffix) → null meridiem. Returns minutes and whether a/p was given. */
function parseClock(raw: string): { min: number; mer: "a" | "p" | null } | null {
  const m = raw.trim().toLowerCase().match(/^(\d{1,2})(?::(\d{2}))?\s*(a|am|p|pm)?\.?$/);
  if (!m) return null;
  const h = Number(m[1]);
  if (h > 23) return null;
  return { min: (h % 12) * 60 + Number(m[2] ?? 0), mer: m[3] ? (m[3][0] as "a" | "p") : null };
}

/** Converts a schedule cell like "9a-6p", "7am-5pm", "8:30am-4:30" into start/end minutes. End may exceed 1440 for overnight. */
export function parseShift(cell: string): { start: number; end: number } | null {
  const m = cell.replace(/\s+/g, "").match(/^(\d{1,2}(?::\d{2})?(?:am|pm|a|p)?)[-–](\d{1,2}(?::\d{2})?(?:am|pm|a|p)?)$/i);
  if (!m) return null;
  const a = parseClock(m[1] ?? ""), b = parseClock(m[2] ?? "");
  if (!a || !b) return null;
  let start = a.min + (a.mer === "p" ? 720 : 0);
  if (a.mer === null && a.min < 6 * 60) start += 720; // "2-10:30p" → 2pm
  let end = b.min + (b.mer === "p" ? 720 : 0);
  if (b.mer === null && end <= start) end += 720;
  if (end <= start) end += 1440; // overnight
  return { start, end };
}

/** When an event has no move-out line, the guessed move out runs this long after the show ends. */
export const MO_GUESS_MIN = 180;

export function formatMinutes(min: number): string {
  const m = min % 1440, h = Math.floor(m / 60), mm = m % 60;
  return `${h % 12 || 12}${mm ? `:${String(mm).padStart(2, "0")}` : ""}${h < 12 ? "a" : "p"}`;
}

/** "06:00 AM" → 360 */
export function parseReportTime(t: string): number {
  const m = t.trim().match(/^(\d{1,2}):(\d{2})\s*([AP])M$/i);
  if (!m) return 0;
  return (Number(m[1]) % 12) * 60 + Number(m[2]) + ((m[3] ?? "").toUpperCase() === "P" ? 720 : 0);
}

// ---------- Ungerboeck event functions ----------
export type EventRow = { level: number; usage: string; start: string; end: string; description: string; space: string; date: string; event?: string; eventId?: string; status?: string };
export type EventCode = "S" | "Exmi" | "MI" | "MO" | "MO?" | "Food" | "Dinner" | "MTG" | "Arr" | "Breakfast" | "Lunch";
export type EventEntry = { date: string; space: string; code: EventCode; start: number; end: number; title: string; eventId?: string };

/** Applies Mark's rules: skip Level 1 date headers; S = show events; Exmi = exhibitor move in; MI = other move in; MO = move out. */
const FOOD_RE = /reception|dinner|lunch|breakfast|buffet|hosted bar|cash bar|wine service|food|concession|coffee|snack|banquet|luncheon|plated|boxed|brunch/;
const SKIP_RE = /inspection|walk-?through|early access|advance freight|deliver|guests? depart|staff arrival|security|show office|break\b|official|lounge|storage|green room|dressing|office|freight|parking|will call|exhibitor access|group out|room turn|strike|warm-?up|check-?in|coat|on.?site/;

/** Service lines inside a show (drinks, food vendors, breaks, entry lines, side rooms). They are not move in, show or move out, so they never get a line of their own. */
const NOISE_RE = /water cooler|coffee|chic?k?-?fil-?a|papa john|concession|coat check|\bbreaks?\b|beverage|refresh|room turn|queue|rehears|speakers? room|conference theat|networking|lip sync|poster|wellness|volunteers? arrive/;

/** The "For Scheduling" report has no Usage column, so the code comes from the description alone. */
export function classifyByDescription(description: string): EventCode | null {
  const d = description.toLowerCase();
  if (/service desk/.test(d)) return "Exmi";
  if (/registration/.test(d) && !/move.?out/.test(d)) return "S"; // registration is the start of the show
  if (/end of show/.test(d)) return "S"; // vendors leaving at the end of the show is still the show
  if (/client arrival/.test(d)) return "Arr";
  if (/move.?out|tear ?down|load.?out|dismantle|out of the building/.test(d)) return "MO";
  if (/exhibitor/.test(d) && /move.?in|load.?in/.test(d)) return "Exmi";
  if (/move.?in|march in|load.?in|set ?up|install|decorator day/.test(d)) return "MI";
  if (NOISE_RE.test(d)) return null;
  if (/\bmeeting\b|\bmtg\b/.test(d) && !/session/.test(d)) return "MTG";
  if (/dinner/.test(d)) return "Dinner";
  if (/breakfast/.test(d)) return "Breakfast";
  if (/lunch|brunch/.test(d)) return "Lunch";
  if (FOOD_RE.test(d)) return "Food";
  if (SKIP_RE.test(d)) return null;
  return "S";
}

export function classifyEvent(row: EventRow): EventCode | null {
  if (row.level <= 1) return null;
  if (!row.usage.trim()) return classifyByDescription(row.description);
  const usage = row.usage.toLowerCase(), desc = row.description.toLowerCase();
  if (usage.includes("move out")) return "MO";
  if (usage.includes("move in")) {
    if (/service desk/.test(desc)) return "Exmi";
    if (/early access|freight|registration/.test(desc)) return null;
    return /exhibitor/.test(desc) ? "Exmi" : "MI";
  }
  if (usage.startsWith("event (evt)") || usage.startsWith("event")) {
    if (/access|inspection|walk/.test(desc)) return null;
    return "S";
  }
  return null;
}

/** Merges rows per date + space + show + code (earliest start, latest end). */
export function summarizeEvents(rows: EventRow[]): EventEntry[] {
  const map = new Map<string, EventEntry>();
  for (const row of rows) {
    const code = classifyEvent(row);
    if (!code) continue;
    const start = parseReportTime(row.start), end = parseReportTime(row.end);
    for (const space of expandSpace(row.space || "Unassigned")) {
      const key = JSON.stringify([row.date, space, row.eventId ?? "", row.event || row.description, code]);
      const prev = map.get(key);
      if (prev) { prev.start = Math.min(prev.start, start); prev.end = Math.max(prev.end, end); }
      else map.set(key, { date: row.date, space, code, start, end, title: row.event || row.description, ...(row.eventId ? { eventId: row.eventId } : {}) });
    }
  }
  // A meal or meeting inside the same show's day is part of the show; only one after the show ends gets its own line.
  const all = [...map.values()];
  // The report names each line separately (Registration, Expo, Coffee Bar...), so lines of one booking match by its event ID.
  const same = (a: EventEntry, b: EventEntry) => a.date === b.date && a.space === b.space && a.eventId === b.eventId && (a.eventId !== undefined || a.title === b.title);
  const kept: EventEntry[] = [];
  for (const e of all) {
    const mates = all.filter((x) => same(x, e) && x !== e);
    const show = mates.find((x) => x.code === "S");
    if (e.code === "Arr") {
      // only worth a line when the client arrives before anything else starts
      const first = Math.min(...mates.filter((x) => x.code !== "Arr").map((x) => x.start), 1e9);
      if (e.start < first && first < 1e9) kept.push({ ...e, end: e.start });
      continue;
    }
    // Breakfast, lunch and dinner always get their own line. Other food and meetings around a show are not move in, show or move out.
    if (e.code === "Breakfast" || e.code === "Lunch" || e.code === "Dinner") { kept.push(e); continue; }
    if (e.code === "Food" || e.code === "MTG") {
      if (show) continue;
      kept.push(e);
      continue;
    }
    kept.push(e);
  }
  // One show line per event, room and day: earliest start to latest end, named by its longest line.
  const shows = new Map<string, EventEntry>();
  for (const e of [...kept]) {
    if (e.code !== "S") continue;
    const key = JSON.stringify([e.date, e.space, e.eventId ?? e.title]);
    const prev = shows.get(key);
    if (!prev) { shows.set(key, e); continue; }
    kept.splice(kept.indexOf(e), 1);
    if (e.end - e.start > prev.end - prev.start) prev.title = e.title;
    prev.start = Math.min(prev.start, e.start); prev.end = Math.max(prev.end, e.end);
  }
  // The show ends where the move out begins, so the two never overlap in a cell.
  for (const e of kept) {
    if (e.code !== "S") continue;
    const mo = kept.find((x) => x.code === "MO" && same(x, e));
    if (mo && mo.start > e.start && mo.start < e.end) e.end = mo.start;
  }
  // No move-out line for an event that had a move in: flag the last day with "MO?" so it gets checked by hand.
  const groups = new Map<string, EventEntry[]>();
  for (const e of kept) { const key = JSON.stringify([e.eventId ?? "", e.eventId ? "" : e.title, e.space]); groups.set(key, [...(groups.get(key) ?? []), e]); }
  for (const list of groups.values()) {
    if (list.some((e) => e.code === "MO") || !list.some((e) => e.code === "MI" || e.code === "Exmi")) continue;
    const last = list.reduce((a, b) => (b.date > a.date || (b.date === a.date && b.end > a.end) ? b : a));
    kept.push({ ...last, code: "MO?", start: last.end, end: Math.min(last.end + MO_GUESS_MIN, 1440) }); // guess: move out runs 3 h after the show
  }
  const order: EventCode[] = ["Arr", "MI", "Exmi", "Breakfast", "S", "Lunch", "Food", "Dinner", "MTG", "MO", "MO?"];
  return kept.sort((a, b) => a.date.localeCompare(b.date) || a.space.localeCompare(b.space) || order.indexOf(a.code) - order.indexOf(b.code));
}

export function entryLabel(e: EventEntry) {
  if (e.code === "MO?") return `MO? ${formatMinutes(e.start)}-${formatMinutes(e.end)}`;
  if (e.code === "Arr") return `Client Arr ${formatMinutes(e.start)}`;
  return `${e.code} ${formatMinutes(e.start)}-${formatMinutes(e.end)}`;
}

/** "10/13/26" → "2026-10-13" */
export function reportDateToIso(d: string): string {
  const m = d.match(/(\d{1,2})\/(\d{1,2})\/(\d{2,4})/);
  if (!m) return d;
  const y = (m[3] ?? "").length === 2 ? `20${m[3]}` : m[3];
  return `${y}-${(m[1] ?? "").padStart(2, "0")}-${(m[2] ?? "").padStart(2, "0")}`;
}

/** Maps Ungerboeck spaces to the weekly sheet rows. */
export function sheetRowFor(space: string): string {
  const s = space.toLowerCase();
  const hall = s.match(/exhibit hall ([a-d]+)/);
  if (hall) return `Hall ${(hall[1] ?? "").toUpperCase()}`;
  const ball = s.match(/ballroom ([a-g]+)/);
  if (ball) return `BallRoom ${(ball[1] ?? "").toUpperCase()}`;
  const conc = s.match(/concourse ([a-d]+)/);
  if (conc) return `Concourse ${(conc[1] ?? "").toUpperCase()}`;
  return space;
}

/** Splits combined spaces into individual sheet rows: "Exhibit Hall AB" → Hall A, Hall B; Chattahoochee/BRFULL → BallRoom A–G. */
export function expandSpace(space: string): string[] {
  const s = space.toLowerCase();
  if (/chattahoochee|brfull/.test(s)) return [..."ABCDEFG"].map((l) => `BallRoom ${l}`);
  const hall = s.match(/exhibit hall ([a-d]+)\b/);
  if (hall) return [...(hall[1] ?? "").toUpperCase()].map((l) => `Hall ${l}`);
  const ball = s.match(/ballroom ([a-g]+)\b/);
  if (ball) return [...(ball[1] ?? "").toUpperCase()].map((l) => `BallRoom ${l}`);
  return [sheetRowFor(space)];
}

/** Fixed sheet order: halls, ballrooms, then anything else. */
export function sheetRowOrder(rows: string[]): string[] {
  const fixed = [..."ABCD"].map((l) => `Hall ${l}`).concat([..."ABCDEFG"].map((l) => `BallRoom ${l}`));
  const used = new Set(rows);
  return [...fixed.filter((r) => used.has(r)), ...[...used].filter((r) => !fixed.includes(r)).sort()];
}

/** Escalators run 1 hour before the first show (S) of the day to 1 hour after the last one ends. */
export function escalatorHours(entries: EventEntry[]): Map<string, { start: number; end: number }> {
  const out = new Map<string, { start: number; end: number }>();
  for (const e of entries) {
    if (e.code !== "S") continue;
    const prev = out.get(e.date);
    const start = Math.max(0, e.start - 60), end = e.end + 60;
    out.set(e.date, prev ? { start: Math.min(prev.start, start), end: Math.max(prev.end, end) } : { start, end });
  }
  return out;
}

export const escalatorLabel = (h: { start: number; end: number }) => `${formatMinutes(h.start)}-${h.end >= 1440 ? "12a" : formatMinutes(h.end)}`;

// ---------- my shifts ----------
/** id: stable across edits, so pushing again updates the same calendar event instead of adding a copy. note: optional text added to the event description. */
export type Shift = { date: string; start: number; end: number; raw: string; id?: string; note?: string };

/** Google event ids use only a-v and 0-9. Derived from the original date and start so re-reading the same sheet gives the same ids. */
export const shiftId = (date: string, start: number): string => `ppshift${date.replace(/\D/g, "")}s${start}`;
export const newShiftId = (rand: () => number = Math.random): string => `ppadd${Math.floor(rand() * 1e12).toString(32).padStart(8, "0")}`;
export const withShiftIds = (list: Shift[]): Shift[] => list.map((x) => (x.id ? x : { ...x, id: shiftId(x.date, x.start) }));
export const shiftLabel = (x: { start: number; end: number }): string => `${formatMinutes(x.start)}-${formatMinutes(x.end)}`;
export const shiftDescription = (x: Shift): string => `Schedule: ${x.raw}${x.note?.trim() ? `\n${x.note.trim().slice(0, 300)}` : ""}`;
/** "09:30" ⇄ minutes. An end earlier than the start means the shift runs past midnight. */
export const minutesToTime = (min: number): string => `${String(Math.floor((min % 1440) / 60)).padStart(2, "0")}:${String(min % 60).padStart(2, "0")}`;
export function timeToMinutes(v: string): number | null {
  const m = /^(\d{1,2}):(\d{2})$/.exec(v.trim());
  return m && Number(m[1]) < 24 && Number(m[2]) < 60 ? Number(m[1]) * 60 + Number(m[2]) : null;
}
/** Apply an edit: keeps the id, fixes an overnight end, and rewrites the schedule text when the times changed. */
export function editShift(x: Shift, change: Partial<Pick<Shift, "date" | "start" | "end" | "note">>): Shift {
  const next: Shift = { ...x, ...change };
  if (next.end <= next.start) next.end += 1440;
  else if (next.end >= 1440 + next.start) next.end -= 1440;
  if (change.start !== undefined || change.end !== undefined) next.raw = shiftLabel(next);
  return next;
}
export const isIsoDate = (d: string): boolean => /^\d{4}-\d{2}-\d{2}$/.test(d) && !Number.isNaN(Date.parse(`${d}T00:00:00Z`));

const pad = (n: number) => String(n).padStart(2, "0");
function stamp(date: string, min: number) {
  const d = new Date(`${date}T00:00:00Z`);
  d.setUTCMinutes(min);
  return `${d.getUTCFullYear()}${pad(d.getUTCMonth() + 1)}${pad(d.getUTCDate())}T${pad(d.getUTCHours())}${pad(d.getUTCMinutes())}00`;
}

export function googleCalendarLink(s: Shift, title = "Mark Work") {
  const q = new URLSearchParams({ action: "TEMPLATE", text: title, dates: `${stamp(s.date, s.start)}/${stamp(s.date, s.end)}`, ctz: TIME_ZONE, details: shiftDescription(s) });
  return `https://calendar.google.com/calendar/render?${q}`;
}

const icsText = (t: string): string => t.replace(/\\/g, "\\\\").replace(/[;,]/g, "\\$&").replace(/\r?\n/g, "\\n");

export function buildIcs(shifts: Shift[], title = "Mark Work"): string {
  const now = new Date().toISOString().replace(/[-:]/g, "").slice(0, 15) + "Z";
  const events = shifts.map((s) => [
    "BEGIN:VEVENT",
    `UID:${s.id ?? `${s.date}-${s.start}`}@pixel-pals`,
    `DTSTAMP:${now}`,
    `DTSTART;TZID=${TIME_ZONE}:${stamp(s.date, s.start)}`,
    `DTEND;TZID=${TIME_ZONE}:${stamp(s.date, s.end)}`,
    `SUMMARY:${icsText(title)}`,
    `DESCRIPTION:${icsText(shiftDescription(s))}`,
    "END:VEVENT",
  ].join("\r\n"));
  return ["BEGIN:VCALENDAR", "VERSION:2.0", "PRODID:-//Pixel Pals//Shifts//EN", ...events, "END:VCALENDAR"].join("\r\n");
}

/** Parses a pasted schedule block. If the paste includes the date row (7 dates under MON–SUN), those dates are used; otherwise dates fall back to the given week-start Monday. */
export function parsePastedShifts(text: string, weekStartIso: string, name = DEFAULT_SCHEDULE_NAME): Shift[] {
  const target = name.trim().toLowerCase();
  const lines = text.split(/\r?\n/);
  const line = lines.find((l) => l.trim().toLowerCase().startsWith(target));
  if (!line) return [];
  let dates: string[] = [];
  for (const l of lines) {
    const found = l.match(/\b\d{1,2}\/\d{1,2}\/\d{2,4}\b/g) ?? [];
    if (found.length >= 7) { dates = found.slice(0, 7).map(reportDateToIso); break; }
  }
  if (dates.length < 7) {
    const monday = new Date(`${weekStartIso}T12:00:00Z`);
    if (Number.isNaN(monday.getTime())) return [];
    dates = Array.from({ length: 7 }, (_, i) => {
      const d = new Date(monday);
      d.setUTCDate(d.getUTCDate() + i);
      return d.toISOString().slice(0, 10);
    });
  }
  const cells = line.split(/\t| {2,}/).map((c) => c.trim()).slice(1);
  const shifts: Shift[] = [];
  for (let i = 0; i < Math.min(cells.length, 7); i++) {
    const raw = cells[i] ?? "";
    const time = parseShift(raw);
    if (!time) continue;
    shifts.push({ date: dates[i]!, ...time, raw });
  }
  return shifts;
}

// ---------- vendors ----------
export const vendors = [
  { name: "Grainger", url: (q: string) => `https://www.grainger.com/search?searchQuery=${encodeURIComponent(q)}`, taxNote: "Tax-exempt certificate on account; gov PO accepted" },
  { name: "McMaster-Carr", url: (q: string) => `https://www.mcmaster.com/${encodeURIComponent(q)}`, taxNote: "Upload exemption certificate; gov PO accepted" },
  { name: "Home Depot", url: (q: string) => `https://www.homedepot.com/s/${encodeURIComponent(q)}`, taxNote: "Pro Xtra tax-exempt ID required" },
  { name: "1000Bulbs", url: (q: string) => `https://www.1000bulbs.com/search/?q=${encodeURIComponent(q)}`, taxNote: "Email exemption certificate to set up account" },
];

export function priceReply(text: string): string | null {
  const m = text.trim().match(/^@(?:price|prices|scout|vendor|vendors|gear)\b[\s,]*(.*)$/i);
  if (!m) return null;
  const q = (m[1] ?? "").trim();
  if (!q) return "Tell me what to look for, like `@price gaffer tape 2in black`.";
  return [
    `**Vendor search: ${q}** (compare pre-tax — you're tax-exempt)`,
    "",
    ...vendors.map((v) => `- [${v.name}](${v.url(q)}) — ${v.taxNote}`),
  ].join("\n");
}

// ---------- weekly engineering sheet layout ----------
export const ENGINEER_ROSTER: { name: string; badge: string; title: string }[] = [
  { name: "Brian Duncan", badge: "600", title: "Director" },
  { name: "Marty Taylor", badge: "601", title: "Chief" },
  { name: "Yvens Joseph", badge: "602", title: "Supervisor" },
  { name: "Mark Brown", badge: "603", title: "Show Srvc Manager" },
  { name: "Madjid Lakhdari", badge: "604", title: "Show Srvc Supervisor" },
  { name: "Alemneh Teshome", badge: "608", title: "Show Srvc Eng" },
  { name: "Alexis Albert", badge: "606", title: "Show Srvc Supervisor" },
  { name: "Edison Dunkley", badge: "605", title: "Show Srvc Supervisor" },
  { name: "Franck Pierre-Louis", badge: "607", title: "Facility Srvc Eng" },
  { name: "Jacquline Dixon", badge: "615", title: "Ops Assistant" },
  { name: "Jontee King", badge: "On-Call", title: "On-Call Show Srvc Eng" },
  { name: "Joseph Desoto", badge: "620", title: "Asst. Chief Engineer" },
  { name: "Daniel Pendleton", badge: "621", title: "CEPAC/CGC Engineer" },
];
export const HALL_ROWS = ["Hall A", "Hall B", "Hall C", "Hall D"];
export const BALLROOM_ROWS = ["BallRoom A", "BallRoom B", "BallRoom E", "BallRoom G", "BallRoom C", "BallRoom D", "BallRoom F"];

/** Next Monday in the user's local calendar (even when today is Monday).
 * Uses local noon so daylight saving changes and UTC date conversion do not shift the day. */
export function nextMondayIso(today: Date = new Date()): string {
  const d = new Date(today.getFullYear(), today.getMonth(), today.getDate(), 12);
  const untilMonday = ((8 - d.getDay()) % 7) || 7;
  d.setDate(d.getDate() + untilMonday);
  const year = d.getFullYear();
  const month = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

/** Monday (ISO date) of the week containing the date. */
export function mondayOf(iso: string): string {
  const d = new Date(`${iso}T12:00:00Z`);
  d.setUTCDate(d.getUTCDate() - ((d.getUTCDay() + 6) % 7));
  return d.toISOString().slice(0, 10);
}
const addDays = (iso: string, n: number) => { const d = new Date(`${iso}T12:00:00Z`); d.setUTCDate(d.getUTCDate() + n); return d.toISOString().slice(0, 10); };

export type WeekLayout = {
  monday: string; dates: string[]; cgc: string[]; escalator: string[]; serviceDesk: string[];
  rows: Record<string, { text: string; codes: EventCode[]; signature: string }[]>; other: string[];
};

/** Groups entries into Monday–Sunday weeks shaped like the CGC engineering schedule. */
export function weekLayouts(entries: EventEntry[]): WeekLayout[] {
  const esc = escalatorHours(entries);
  const mondays = [...new Set(entries.map((e) => mondayOf(e.date)))].sort();
  return mondays.map((monday) => {
    const dates = Array.from({ length: 7 }, (_, i) => addDays(monday, i));
    const week = entries.filter((e) => dates.includes(e.date));
    const labels = new Set(week.map((e) => e.space));
    const other = [...labels].filter((l) => !HALL_ROWS.includes(l) && !BALLROOM_ROWS.includes(l)).sort();
    const rows: WeekLayout["rows"] = {};
    for (const label of [...HALL_ROWS, ...BALLROOM_ROWS, ...other]) {
      rows[label] = dates.map((d) => {
        const list = week.filter((e) => e.date === d && e.space === label).sort((a, b) => a.start - b.start);
        if (!list.length) return { text: "", codes: [], signature: "" };
        const titles = [...new Set(list.map((e) => e.title))];
        const text = titles.flatMap((title) => [title, ...list.filter((e) => e.title === title).map(entryLabel)]).filter(Boolean).join("\n");
        const signature = JSON.stringify(list.map((e) => [e.title, e.code, e.start, e.end]).sort((a, b) => JSON.stringify(a).localeCompare(JSON.stringify(b))));
        return { text, codes: [...new Set(list.map((e) => e.code))], signature };
      });
    }
    const cgc = dates.map((d) => {
      const day = week.filter((e) => e.date === d);
      if (!day.length) return "DARK";
      return `${formatMinutes(Math.min(...day.map((e) => e.start)))}-${formatMinutes(Math.max(...day.map((e) => e.end)))}`;
    });
    const escalator = dates.map((d) => { const h = esc.get(d); return h ? escalatorLabel(h) : ""; });
    const serviceDesk = dates.map((d) => {
      const desk = week.filter((e) => e.date === d && e.code === "Exmi");
      return desk.length ? `${formatMinutes(Math.min(...desk.map((e) => e.start)))}-${formatMinutes(Math.max(...desk.map((e) => e.end)))}` : "";
    });
    return { monday, dates, cgc, escalator, serviceDesk, rows, other };
  });
}


// ---------- task suggestions ----------
export type TaskNote = { date: string; section: "HALLS" | "BALLROOM"; text: string };

/** Stage builds and room turns found in the report, ready for the Tasks rows. The user's own text is never overwritten. */
export function taskSuggestions(rows: EventRow[]): TaskNote[] {
  const out = new Map<string, TaskNote>();
  for (const row of rows) {
    if (row.level <= 1) continue;
    const d = row.description;
    const stage = /\bstage\b|riser|platform|truss/i.test(d) && !/show office/i.test(d);
    const turn = /room turn|room refresh|flip/i.test(d);
    if (!stage && !turn) continue;
    const spaces = expandSpace(row.space || "");
    const first = spaces[0] ?? "";
    const section = /^hall/i.test(first) ? "HALLS" : /^ballroom/i.test(first) ? "BALLROOM" : null;
    if (!section) continue;
    const room = spaces.length > 1 ? `${first.replace(/^(Hall|BallRoom) /, "")}–${spaces[spaces.length - 1]!.replace(/^(Hall|BallRoom) /, "")}` : first.replace(/^(Hall|BallRoom) /, "");
    const where = section === "HALLS" ? `Hall ${room}` : `BR ${room}`;
    const clean = d.replace(/\s+/g, " ").trim();
    const text = `${turn ? (/^room/i.test(clean) ? "" : "Room turn: ") : "Stage: "}${clean} (${where} ${formatMinutes(parseReportTime(row.start))})`;
    out.set(JSON.stringify([row.date, section, text]), { date: row.date, section, text });
  }
  return [...out.values()].sort((a, b) => a.date.localeCompare(b.date) || a.text.localeCompare(b.text));
}

// ---------- air walls ----------
const letters = (space: string): { section: "HALLS" | "BALLROOM"; group: string } | null => {
  const s = space.toLowerCase();
  const hall = s.match(/exhibit hall ([a-d]+)\b/);
  if (hall) return { section: "HALLS", group: (hall[1] ?? "").toUpperCase() };
  if (/chattahoochee|brfull/.test(s)) return { section: "BALLROOM", group: "ABCDEFG" };
  const ball = s.match(/ballroom ([a-g]+)\b/);
  if (ball) return { section: "BALLROOM", group: (ball[1] ?? "").toUpperCase() };
  return null;
};

/** "Make AB" tasks: air walls change when a room is used in a different combination than last time.
 * The task goes as early as the room is free (the day after it was last used, but not before that week's Monday).
 * When one day needs two overlapping shapes (full ballroom, then ABE), the later one is made that same day. */
export function airwallTasks(rows: EventRow[]): TaskNote[] {
  const used = rows.filter((r) => { const c = r.level > 1 ? classifyEvent(r) : null; return (c === "S" || c === "MI" || c === "Exmi" || c === "MO") && letters(r.space || ""); });
  const dates = [...new Set(used.map((r) => r.date))].sort();
  const out = new Map<string, TaskNote>();
  for (const section of ["HALLS", "BALLROOM"] as const) {
    const config = new Map<string, { g: string; owner: string }>(); // letter -> shape its walls are in, and which event set it
    const owners = new Map<string, string>(); // date|group -> the event using it
    const sessions = new Set<string>(); // date|group where an actual session runs (not only move in/out)
    const busy = new Map<string, Set<string>>(); // date -> letters in use
    const first = new Map<string, number>(); // date|group -> earliest start that day
    for (const r of used) {
      const l = letters(r.space);
      if (l?.section !== section) continue;
      busy.set(r.date, new Set([...(busy.get(r.date) ?? []), ...l.group]));
      if (!owners.has(`${r.date}|${l.group}`)) owners.set(`${r.date}|${l.group}`, r.eventId || r.event || "");
      if (classifyEvent(r) === "S") sessions.add(`${r.date}|${l.group}`);
      const k = `${r.date}|${l.group}`;
      first.set(k, Math.min(first.get(k) ?? 1e9, parseReportTime(r.start)));
    }
    for (const date of dates) {
      const groups = [...new Set(used.map((r) => (r.date === date ? letters(r.space) : null)).filter((l) => l?.section === section).map((l) => l!.group))]
        .sort((a, b) => (first.get(`${date}|${a}`) ?? 0) - (first.get(`${date}|${b}`) ?? 0) || a.localeCompare(b));
      const earlier: string[] = [];
      for (const g of groups) {
        const owner = owners.get(`${date}|${g}`) ?? "";
        const known = [...g].filter((c) => config.has(c));
        // Moving in or out of a smaller part of a room the same event already opened (ABC, then AB on move out day) does not move any wall; running a session there does.
        const inherited = (c: string) => { const cfg = config.get(c); return !sessions.has(`${date}|${g}`) && !!cfg && cfg.owner !== "" && cfg.owner === owner && [...g].every((x) => cfg.g.includes(x)); };
        const changed = known.length > 0 && [...g].some((c) => config.get(c)?.g !== g && !inherited(c));
        if (changed) {
          let day: string;
          if (earlier.some((h) => [...h].some((c) => g.includes(c)))) day = date; // after the earlier shape is done that day
          else {
            let last = ""; // last day before this one that any of these rooms was in use
            for (const d of [...busy.keys()].sort()) if (d < date && [...g].some((c) => busy.get(d)!.has(c))) last = d;
            const monday = mondayOf(date);
            const free = last ? addDays(last, 1) : monday;
            // free whole days before the show: use the first; otherwise the room's last busy day (after that event ends)
            day = free >= date ? (last || date) : free < monday ? monday : free;
          }
          out.set(JSON.stringify([day, section, g]), { date: day, section, text: g });
        }
        earlier.push(g);
        for (const c of g) {
          if (inherited(c)) continue;
          const old = config.get(c)?.g ?? "";
          const rest = [...old].filter((x) => !g.includes(x)).join(""); // rooms that were joined to this one are now cut off from it
          if (rest) for (const x of rest) config.set(x, { g: rest, owner: "" });
          config.set(c, { g, owner });
        }
      }
    }
  }
  // One line per day and section: "Make Hall AB", "Make ABE/CDFG", "Make full ballroom".
  const merged = new Map<string, TaskNote>();
  for (const t of [...out.values()].sort((a, b) => a.text.localeCompare(b.text))) {
    const key = `${t.date}|${t.section}`;
    const name = t.section === "BALLROOM" && t.text === "ABCDEFG" ? "full ballroom" : t.text;
    const prev = merged.get(key);
    merged.set(key, { date: t.date, section: t.section, text: prev ? `${prev.text}/${name}` : `Make ${t.section === "HALLS" ? "Hall " : ""}${name}` });
  }
  return [...merged.values()].sort((a, b) => a.date.localeCompare(b.date) || a.text.localeCompare(b.text));
}

/** Rooms with more than one event on the same day, so the person can see when shows share space. */
export function sharedSpaces(entries: EventEntry[]): string[] {
  const map = new Map<string, Set<string>>();
  for (const e of entries) {
    if (e.code === "MTG" || e.code === "Food" || e.code === "Dinner" || e.code === "Breakfast" || e.code === "Lunch" || e.code === "Arr" || e.code === "MO?") continue;
    const key = `${e.date}|${e.space}`;
    map.set(key, new Set([...(map.get(key) ?? []), e.title]));
  }
  return [...map.entries()].filter(([, t]) => t.size > 1).sort(([a], [b]) => a.localeCompare(b)).map(([k, t]) => `${k.split("|")[0]} · ${k.split("|")[1]}: ${[...t].join(" + ")}`);
}

/** Pending, tentative or hold events are not guaranteed yet; PDFs carry no status, so those rows count as confirmed. */
export const isPendingRow = (r: { status?: string }): boolean => !!r.status && !/^definite/i.test(r.status.trim());
export const isCancelledRow = (r: { event?: string }): boolean => /^\s*cancel/i.test(r.event ?? "");

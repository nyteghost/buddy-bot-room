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
export type EventRow = { level: number; usage: string; start: string; end: string; description: string; space: string; date: string; event?: string };
export type EventCode = "S" | "Exmi" | "MI" | "MO";
export type EventEntry = { date: string; space: string; code: EventCode; start: number; end: number; title: string };

/** Applies Mark's rules: skip Level 1 date headers; S = show events; Exmi = exhibitor move in; MI = other move in; MO = move out. */
export function classifyEvent(row: EventRow): EventCode | null {
  if (row.level <= 1) return null;
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

/** Merges rows into one entry per date + space + code (earliest start, latest end). */
export function summarizeEvents(rows: EventRow[]): EventEntry[] {
  const map = new Map<string, EventEntry>();
  for (const row of rows) {
    const code = classifyEvent(row);
    if (!code) continue;
    const start = parseReportTime(row.start), end = parseReportTime(row.end);
    for (const space of expandSpace(row.space || "Unassigned")) {
      const key = `${row.date}|${space}|${code}`;
      const prev = map.get(key);
      if (prev) { prev.start = Math.min(prev.start, start); prev.end = Math.max(prev.end, end); }
      else map.set(key, { date: row.date, space, code, start, end, title: row.event || row.description });
    }
  }
  const order: EventCode[] = ["MI", "Exmi", "S", "MO"];
  return [...map.values()].sort((a, b) => a.date.localeCompare(b.date) || a.space.localeCompare(b.space) || order.indexOf(a.code) - order.indexOf(b.code));
}

export function entryLabel(e: EventEntry) {
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
export type Shift = { date: string; start: number; end: number; raw: string };

const pad = (n: number) => String(n).padStart(2, "0");
function stamp(date: string, min: number) {
  const d = new Date(`${date}T00:00:00Z`);
  d.setUTCMinutes(min);
  return `${d.getUTCFullYear()}${pad(d.getUTCMonth() + 1)}${pad(d.getUTCDate())}T${pad(d.getUTCHours())}${pad(d.getUTCMinutes())}00`;
}

export function googleCalendarLink(s: Shift, title = "Mark Work") {
  const q = new URLSearchParams({ action: "TEMPLATE", text: title, dates: `${stamp(s.date, s.start)}/${stamp(s.date, s.end)}`, ctz: TIME_ZONE, details: `Schedule: ${s.raw}` });
  return `https://calendar.google.com/calendar/render?${q}`;
}

export function buildIcs(shifts: Shift[], title = "Mark Work"): string {
  const now = new Date().toISOString().replace(/[-:]/g, "").slice(0, 15) + "Z";
  const events = shifts.map((s) => [
    "BEGIN:VEVENT",
    `UID:${s.date}-${s.start}@pixel-pals`,
    `DTSTAMP:${now}`,
    `DTSTART;TZID=${TIME_ZONE}:${stamp(s.date, s.start)}`,
    `DTEND;TZID=${TIME_ZONE}:${stamp(s.date, s.end)}`,
    `SUMMARY:${title}`,
    `DESCRIPTION:Schedule ${s.raw}`,
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

/** Monday (ISO date) of the week containing the date. */
export function mondayOf(iso: string): string {
  const d = new Date(`${iso}T12:00:00Z`);
  d.setUTCDate(d.getUTCDate() - ((d.getUTCDay() + 6) % 7));
  return d.toISOString().slice(0, 10);
}
const addDays = (iso: string, n: number) => { const d = new Date(`${iso}T12:00:00Z`); d.setUTCDate(d.getUTCDate() + n); return d.toISOString().slice(0, 10); };

export type WeekLayout = {
  monday: string; dates: string[]; cgc: string[]; escalator: string[]; serviceDesk: string[];
  rows: Record<string, { text: string; codes: EventCode[] }[]>; other: string[];
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
        if (!list.length) return { text: "", codes: [] };
        const title = list.find((e) => e.code === "S")?.title ?? list[0]!.title;
        return { text: [title, ...list.map(entryLabel)].filter(Boolean).join("\n"), codes: [...new Set(list.map((e) => e.code))] };
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

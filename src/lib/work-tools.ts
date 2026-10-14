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
  const a = parseClock(m[1]), b = parseClock(m[2]);
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
  return (Number(m[1]) % 12) * 60 + Number(m[2]) + (m[3].toUpperCase() === "P" ? 720 : 0);
}

// ---------- Ungerboeck event functions ----------
export type EventRow = { level: number; usage: string; start: string; end: string; description: string; space: string; date: string };
export type EventCode = "S" | "Exmi" | "MI" | "MO";
export type EventEntry = { date: string; space: string; code: EventCode; start: number; end: number; title: string };

/** Applies Mark's rules: skip Level 1 date headers; S = show events; Exmi = exhibitor move in; MI = other move in; MO = move out. */
export function classifyEvent(row: EventRow): EventCode | null {
  if (row.level <= 1) return null;
  const usage = row.usage.toLowerCase(), desc = row.description.toLowerCase();
  if (usage.includes("move out")) return "MO";
  if (usage.includes("move in")) {
    if (/service desk|early access|freight|registration/.test(desc)) return null;
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
    const space = row.space || "Unassigned";
    const key = `${row.date}|${space}|${code}`;
    const start = parseReportTime(row.start), end = parseReportTime(row.end);
    const prev = map.get(key);
    if (prev) { prev.start = Math.min(prev.start, start); prev.end = Math.max(prev.end, end); }
    else map.set(key, { date: row.date, space, code, start, end, title: row.description });
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
  const y = m[3].length === 2 ? `20${m[3]}` : m[3];
  return `${y}-${m[1].padStart(2, "0")}-${m[2].padStart(2, "0")}`;
}

/** Maps Ungerboeck spaces to the weekly sheet rows. */
export function sheetRowFor(space: string): string {
  const s = space.toLowerCase();
  const hall = s.match(/exhibit hall ([a-d]+)/);
  if (hall) return `Hall ${hall[1].toUpperCase()}`;
  const ball = s.match(/ballroom ([a-g]+)/);
  if (ball) return `BallRoom ${ball[1].toUpperCase()}`;
  const conc = s.match(/concourse ([a-d]+)/);
  if (conc) return `Concourse ${conc[1].toUpperCase()}`;
  return space;
}

// ---------- my shifts ----------
export type Shift = { date: string; start: number; end: number; raw: string };

const pad = (n: number) => String(n).padStart(2, "0");
function stamp(date: string, min: number) {
  const d = new Date(`${date}T00:00:00Z`);
  d.setUTCMinutes(min);
  return `${d.getUTCFullYear()}${pad(d.getUTCMonth() + 1)}${pad(d.getUTCDate())}T${pad(d.getUTCHours())}${pad(d.getUTCMinutes())}00`;
}

export function googleCalendarLink(s: Shift, title = "Work shift") {
  const q = new URLSearchParams({ action: "TEMPLATE", text: title, dates: `${stamp(s.date, s.start)}/${stamp(s.date, s.end)}`, ctz: TIME_ZONE, details: `Schedule: ${s.raw}` });
  return `https://calendar.google.com/calendar/render?${q}`;
}

export function buildIcs(shifts: Shift[], title = "Work shift"): string {
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
  const q = m[1].trim();
  if (!q) return "Tell me what to look for, like `@price gaffer tape 2in black`.";
  return [
    `**Vendor search: ${q}** (compare pre-tax — you're tax-exempt)`,
    "",
    ...vendors.map((v) => `- [${v.name}](${v.url(q)}) — ${v.taxNote}`),
  ].join("\n");
}

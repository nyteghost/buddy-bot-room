/** Time-of-day helpers for the server's daily jobs (backup, morning brief). Pure: uses Intl, so it doesn't depend on the OS time zone. */
export function validZone(tz: string | undefined): string | null {
  if (!tz) return null;
  try { new Intl.DateTimeFormat("en-CA", { timeZone: tz }); return tz; } catch { return null; }
}

export function parseHm(v: string | undefined, fallback: string): string {
  const t = (v ?? "").trim();
  return /^([01]\d|2[0-3]):[0-5]\d$/.test(t) ? t : fallback;
}

/** The calendar day ("2026-10-19") and clock time ("08:30") in a zone. */
export function zonedParts(date: Date, tz: string): { day: string; hm: string; stamp: string } {
  const f = new Intl.DateTimeFormat("en-CA", { timeZone: validZone(tz) ?? "UTC", year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", hourCycle: "h23" });
  const p: Record<string, string> = {};
  for (const x of f.formatToParts(date)) p[x.type] = x.value;
  return { day: `${p["year"]}-${p["month"]}-${p["day"]}`, hm: `${p["hour"]}:${p["minute"]}`, stamp: `${p["year"]}-${p["month"]}-${p["day"]}-${p["hour"]}${p["minute"]}` };
}

const minutes = (hm: string): number => Number(hm.slice(0, 2)) * 60 + Number(hm.slice(3, 5));

/** True once per day, within `windowMin` minutes after the target time (a late restart doesn't fire yesterday's job). */
export function isDue(now: Date, tz: string, target: string, lastDay: string, windowMin = 10): boolean {
  const z = zonedParts(now, tz);
  const diff = minutes(z.hm) - minutes(target);
  return z.day !== lastDay && diff >= 0 && diff <= windowMin;
}

export function ageText(ms: number): string {
  const m = Math.round(ms / 60000);
  if (m < 2) return "just now";
  if (m < 120) return `${m} minutes ago`;
  const h = Math.round(m / 60);
  return h < 48 ? `${h} hours ago` : `${Math.round(h / 24)} days ago`;
}

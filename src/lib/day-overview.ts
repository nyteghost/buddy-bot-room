/** Day navigation is based on calendar date, not fixed 24-hour offsets, so DST changes are safe. */
export function offsetDateKey(key: string, offset: number): string {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(key) || !Number.isInteger(offset) || Math.abs(offset) > 30) return key;
  const [y, m, d] = key.split("-").map(Number);
  const date = new Date(Date.UTC(y!, m! - 1, d! + offset));
  return date.toISOString().slice(0, 10);
}

export function zoneDateKey(ms: number, zone: string): string {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: zone, year: "numeric", month: "2-digit", day: "2-digit",
  }).formatToParts(new Date(ms));
  const get = (type: string) => parts.find((part) => part.type === type)?.value ?? "";
  return get("year") + "-" + get("month") + "-" + get("day");
}

export type DayEvent = { title: string; start: number; end: number; allDay: boolean };
export function eventsOnDay<T extends DayEvent>(items: T[], dateKey: string, zone: string, now = Date.now()): T[] {
  const currentDay = zoneDateKey(now, zone);
  return items.filter((event) => {
    if (event.end <= event.start) return false;
    const startKey = zoneDateKey(event.start, zone);
    const endKey = zoneDateKey(event.end - 1, zone); // end-exclusive all-day events
    return startKey <= dateKey && endKey >= dateKey && (dateKey !== currentDay || event.end >= now || event.allDay);
  });
}

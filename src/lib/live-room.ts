import type { AgentId } from "./agents";

/** Pure helpers for the living room: time of day, sky, and the short lines the pals say from real data (no AI calls). */
export type Phase = "dawn" | "day" | "dusk" | "night";
export type Sky = "clear" | "cloud" | "rain" | "snow" | "storm" | "fog";

export const phaseOf = (hour: number): Phase => (hour >= 5 && hour < 8 ? "dawn" : hour >= 8 && hour < 17 ? "day" : hour >= 17 && hour < 20 ? "dusk" : "night");

export function skyOf(code: number): Sky {
  if ([95, 96, 99].includes(code)) return "storm";
  if ([71, 73, 75, 77, 85, 86].includes(code)) return "snow";
  if ([51, 53, 55, 56, 57, 61, 63, 65, 66, 67, 80, 81, 82].includes(code)) return "rain";
  if ([45, 48].includes(code)) return "fog";
  if ([2, 3].includes(code)) return "cloud";
  return "clear";
}

export type LiveData = {
  weather?: { text: string; icon: string; temp: string; sky: Sky } | undefined;
  /** Unread count; undefined when mail isn't connected. */
  unread?: number | undefined;
  newest?: string | undefined;
  /** Next calendar item; null means nothing coming up, undefined means not connected. */
  next?: { title: string; when: string } | null | undefined;
  tasks: number;
  /** null = not configured, true = healthy, string = first problem. */
  server?: null | true | string | undefined;
};
export type Line = { agent: AgentId; text: string };

const clip = (s: string, n: number) => (s.length > n ? `${s.slice(0, n - 1)}…` : s);

/** One short line per area we have data for. */
export function ambientLines(d: LiveData): Line[] {
  const out: Line[] = [];
  if (d.unread !== undefined) out.push({ agent: "nova", text: d.unread > 0 ? `${d.unread} unread${d.newest ? `. Newest: ${clip(d.newest, 50)}` : ""}` : "Inbox is clear." });
  if (d.next !== undefined) out.push({ agent: "sage", text: d.next ? `Next up: ${clip(d.next.title, 40)}, ${d.next.when}.` : "Nothing coming up on the calendar." });
  out.push({ agent: "byte", text: d.tasks > 0 ? `${d.tasks} open task${d.tasks === 1 ? "" : "s"} on the board.` : "All tasks done. Nice." });
  if (d.server !== undefined && d.server !== null) out.push({ agent: "rune", text: d.server === true ? "Server's healthy." : `Heads up: ${clip(d.server, 70)}` });
  if (d.weather) out.push({ agent: "echo", text: `${d.weather.text}, ${d.weather.temp}.` });
  return out;
}

/** "today 3:30 PM" / "tomorrow 9:00 AM" / "Fri 9:00 AM". */
export function whenText(start: number, now: number, zone: string, allDay = false): string {
  const dayKey = (t: number) => new Intl.DateTimeFormat("en-CA", { timeZone: zone }).format(t);
  const time = new Intl.DateTimeFormat("en-US", { timeZone: zone, hour: "numeric", minute: "2-digit" }).format(start);
  const k = dayKey(start);
  const day = k === dayKey(now) ? "today" : k === dayKey(now + 86400_000) ? "tomorrow" : new Intl.DateTimeFormat("en-US", { timeZone: zone, weekday: "short" }).format(start);
  return allDay ? day : `${day} ${time}`;
}

/** Things on the shelf that look worth your attention (a red dot). */
export function needsAttention(d: LiveData): { mail: boolean; server: boolean } {
  return { mail: (d.unread ?? 0) > 0, server: typeof d.server === "string" };
}

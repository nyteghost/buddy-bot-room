/** The morning brief: pure text-building and the daily pick. */
import type { TraktItem } from "./trakt";
import { formatDuration, type UnraidStatus } from "./unraid";

export type BriefInput = {
  /** "2026-10-19" in the user's time zone. */
  day: string;
  /** undefined = Unraid isn't monitored; null = monitored but no check has finished yet. */
  unraid?: UnraidStatus | null;
  backup?: string;
  /** Trakt-list picks for today (see dailyPicks). */
  picks?: TraktItem[];
  /** Recently added to Plex. */
  recent?: string[];
  /** One line, e.g. from weatherLine. */
  weather?: string;
  /** Today's calendar lines ("09:30 Standup"). */
  events?: string[];
  /** Unread mail: count and the first few subjects. */
  mail?: { count: number; top: string[] };
  /** Open to-dos / reminders for today. */
  tasks?: string[];
};

function hash(s: string): number {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 16777619); }
  return h >>> 0;
}

/** Same day, same picks (so a preview and the real brief agree). Prefers unwatched items Plex already has. */
export function dailyPicks(items: TraktItem[], seed: string, n = 3): TraktItem[] {
  const open = items.filter((i) => !i.watched);
  const ready = open.filter((i) => i.inPlex === true);
  const pool = ready.length ? ready : open;
  if (!pool.length) return [];
  const start = hash(seed) % pool.length;
  return Array.from({ length: Math.min(n, pool.length) }, (_, k) => pool[(start + k) % pool.length] as TraktItem);
}

const label = (i: TraktItem) => `${i.title}${i.year ? ` (${i.year})` : ""}`;

export function unraidLine(s: UnraidStatus | null | undefined): string {
  if (s === undefined) return "";
  if (s === null) return "Unraid: waiting for the first check.";
  if (!s.reachable) return "⚠ Unraid is unreachable.";
  if (s.problems.length) return `⚠ Unraid needs attention: ${s.problems.slice(0, 3).join(" ")}`;
  const hot = s.disks.reduce((m, d) => Math.max(m, d.tempC ?? 0), 0);
  const bits = [s.containers.length ? `${s.containers.filter((c) => c.state === "running").length}/${s.containers.length} containers running` : "", hot ? `hottest disk ${hot}°C` : "", s.uptimeSeconds !== undefined ? `up ${formatDuration(s.uptimeSeconds)}` : ""].filter(Boolean);
  return `Unraid is healthy${bits.length ? ` (${bits.join(", ")})` : ""}.`;
}

export function buildBrief(input: BriefInput): { title: string; body: string } {
  const when = new Date(`${input.day}T12:00:00Z`).toLocaleDateString("en-US", { weekday: "short", month: "short", day: "numeric", timeZone: "UTC" });
  const lines: string[] = [];
  if (input.weather) lines.push(input.weather);
  if (input.events) lines.push("", input.events.length ? `Today: ${input.events.slice(0, 5).join(" · ")}${input.events.length > 5 ? ` (+${input.events.length - 5} more)` : ""}` : "Nothing on your calendar today.");
  if (input.mail) lines.push(input.mail.count ? `Unread mail: ${input.mail.count}${input.mail.top.length ? ` — ${input.mail.top.slice(0, 3).join("; ")}` : ""}` : "No unread mail.");
  if (input.tasks?.length) lines.push(`To do: ${input.tasks.slice(0, 5).join("; ")}`);
  if (lines.length) lines.push("");
  const u = unraidLine(input.unraid);
  if (u) lines.push(u);
  if (input.backup) lines.push(input.backup);
  const [first, ...rest] = input.picks ?? [];
  if (first) {
    lines.push("", `Tonight's pick: ${label(first)}${first.inPlex === true ? " — in Plex" : first.inPlex === false ? " — not in Plex yet (/request it)" : ""}`);
    if (rest.length) lines.push(`Or: ${rest.map(label).join(", ")}`);
  }
  if (input.recent?.length) lines.push("", `New in Plex: ${input.recent.slice(0, 5).join(", ")}`);
  while (lines[0] === "") lines.shift();
  if (!lines.length) lines.push("Nothing to report. Set up Unraid, Trakt or Plex to fill this in.");
  return { title: `Good morning — ${when}`, body: lines.join("\n") };
}

import { calendarData, mailData } from "./inbox.server";
import { dailyPicks } from "./brief";
import { handleTrakt } from "./trakt.server";
import type { TraktItem } from "./trakt";
import { parseHm, validZone, zonedParts } from "./schedule";
import { buildWeekly, reviewDay } from "./weekly";
import { readReminders } from "./reminders.server";
import { getWeather, weatherConfigured } from "./weather.server";
import { weatherText } from "./weather";
import { pushNotice } from "./schedules.server";
import { wallOf, whenLabel } from "./when";

/** Weekly review: set REVIEW_DAY (sun) and REVIEW_TIME (18:00). Sent with the same push settings as the morning brief. */
export type WeeklyConfig = { day: number; time: string; tz: string };
const tzName = () => validZone(process.env["BUDDY_TZ"]) ?? validZone(Intl.DateTimeFormat().resolvedOptions().timeZone) ?? "UTC";

export function weeklyConfig(env: Record<string, string | undefined> = process.env): WeeklyConfig | null {
  const day = reviewDay(env["REVIEW_DAY"]);
  const t = (env["REVIEW_TIME"] ?? "").trim();
  if (day === null || !/^([01]\d|2[0-3]):[0-5]\d$/.test(t)) return null;
  return { day, time: parseHm(t, "18:00"), tz: tzName() };
}

export const isReviewDay = (now: Date, cfg: WeeklyConfig): boolean => wallOf(now.getTime(), cfg.tz).wd === cfg.day;

export async function makeWeekly(now = new Date()): Promise<{ title: string; body: string }> {
  const tz = tzName();
  const key = (ms: number) => zonedParts(new Date(ms), tz).day;
  const start = now.getTime();
  const [cal, mail, reminders, weather, trakt] = await Promise.all([
    calendarData(7).catch(() => null),
    mailData().catch(() => null),
    readReminders().catch(() => []),
    weatherConfigured() ? getWeather().catch(() => null) : null,
    handleTrakt(new Request("http://internal/api/trakt?plex=1")).then(async (r) => (r.ok ? ((await r.json()) as { items?: TraktItem[] }) : null)).catch(() => null),
  ]);
  const days = Array.from({ length: 7 }, (_, n) => {
    const ms = start + (n + 1) * 86_400_000;
    const d = key(ms);
    return { label: new Intl.DateTimeFormat("en-US", { timeZone: tz, weekday: "short", month: "short", day: "numeric" }).format(new Date(ms)), events: (cal?.configured ? cal.items : []).filter((e) => key(e.start) === d).map((e) => `${e.allDay ? "" : new Intl.DateTimeFormat("en-US", { timeZone: tz, hour: "numeric", minute: "2-digit" }).format(new Date(e.start)) + " "}${e.title}`) };
  });
  const horizon = start + 8 * 86_400_000;
  return buildWeekly({
    from: new Intl.DateTimeFormat("en-US", { timeZone: tz, month: "short", day: "numeric" }).format(new Date(start + 86_400_000)),
    days,
    reminders: reminders.filter((r) => r.at <= horizon).map((r) => `${whenLabel(r.at, tz)} — ${r.text}`),
    mail: mail?.configured ? { count: mail.items.length } : undefined,
    picks: dailyPicks(trakt?.items ?? [], zonedParts(now, tz).day, 3).map((p) => p.title),
    weather: weather && "weather" in weather ? weatherText(weather.weather).split("\n").slice(0, 1).join("") : undefined,
  });
}

export async function sendWeekly(): Promise<{ ok: boolean; text: string }> {
  const w = await makeWeekly();
  const ntfy = (process.env["NTFY_URL"] ?? "").trim().startsWith("http");
  const tg = !!process.env["TELEGRAM_BOT_TOKEN"];
  if (!ntfy && !tg) return { ok: false, text: `Set NTFY_URL or TELEGRAM_BOT_TOKEN to send it to your phone.\n\n**${w.title}**\n\n${w.body}` };
  await pushNotice(w.title, w.body);
  return { ok: true, text: `Sent to your phone:\n\n**${w.title}**\n\n${w.body}` };
}

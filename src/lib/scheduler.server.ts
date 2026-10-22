import { backupAgeMs, backupConfig, runBackup } from "./backup.server";
import { briefConfig, sendBrief } from "./brief.server";
import { isDue, zonedParts } from "./schedule";
import { logServer } from "./server-log.server";
import { startFeedTimer } from "./model-feed.server";
import { startProviderTimer } from "./provider-feed.server";
import { ollamaBase } from "./ollama.server";
import { tickReminders } from "./reminders.server";
import { tickToday } from "./today.server";
import { tickUpdate } from "./update.server";
import { tickCaldav } from "./reminders-sync.server";
import { isReviewDay, sendWeekly, weeklyConfig } from "./weekly.server";
import { tickSchedules } from "./schedules.server";
import { startTelegram } from "./telegram.server";
import { tickPlaytests } from "./playtests.server";

/** One 30-second ticker for the daily jobs. Idempotent. Does nothing unless a job is configured. */
type S = { timer?: ReturnType<typeof setInterval>; lastBackupDay: string; lastBriefDay: string; lastReviewDay?: string };
const dataDir = () => (process.env["BUDDY_DATA_DIR"] ?? "").trim();
const holder = globalThis as unknown as { __buddyScheduler?: S };

export function startScheduler(): void {
  if (ollamaBase()) startFeedTimer();
  startProviderTimer();
  if (holder.__buddyScheduler?.timer) return;
  startTelegram();
  if (!backupConfig() && !briefConfig() && !weeklyConfig() && !dataDir()) return;
  const s: S = (holder.__buddyScheduler ??= { lastBackupDay: "", lastBriefDay: "" });
  logServer("info", "Scheduler started");
  s.timer = setInterval(() => { void tick(s); }, 30_000);
  (s.timer as { unref?: () => void }).unref?.();
  // After a restart: if the newest backup is more than a day old (or there is none), make one soon.
  const t = setTimeout(async () => {
    const cfg = backupConfig();
    if (!cfg) return;
    const age = await backupAgeMs(cfg);
    if (age === null || age > 25 * 3600 * 1000) { s.lastBackupDay = zonedParts(new Date(), cfg.tz).day; await runBackup(cfg); }
  }, 45_000);
  (t as { unref?: () => void }).unref?.();
}

async function tick(s: S): Promise<void> {
  const now = new Date();
  const cfg = backupConfig();
  if (cfg && isDue(now, cfg.tz, cfg.time, s.lastBackupDay)) {
    s.lastBackupDay = zonedParts(now, cfg.tz).day;
    await runBackup(cfg, now);
  }
  await tickSchedules(now).catch(() => undefined);
  await tickReminders(now.getTime()).catch(() => undefined);
  await tickUpdate(now.getTime()).catch(() => undefined);
  await tickCaldav(now.getTime()).catch(() => undefined);
  await tickToday(now.getTime()).catch(() => undefined);
  await tickPlaytests(now.getTime()).catch(() => undefined);
  const review = weeklyConfig();
  if (review && isReviewDay(now, review) && isDue(now, review.tz, review.time, s.lastReviewDay ?? "")) {
    s.lastReviewDay = zonedParts(now, review.tz).day;
    const r = await sendWeekly();
    if (!r.ok) logServer("warn", "Weekly review not sent: no phone push configured");
  }
  const brief = briefConfig();
  if (brief && isDue(now, brief.tz, brief.time, s.lastBriefDay)) {
    s.lastBriefDay = zonedParts(now, brief.tz).day;
    const r = await sendBrief();
    if (!r.ok) logServer("warn", `Morning brief not sent: ${r.error}`);
  }
}

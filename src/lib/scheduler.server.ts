import { backupAgeMs, backupConfig, runBackup } from "./backup.server";
import { briefConfig, sendBrief } from "./brief.server";
import { isDue, zonedParts } from "./schedule";
import { logServer } from "./server-log.server";
import { jobs } from "./jobs.server";
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
import { tickMailAlerts } from "./mail-alerts.server";
import { tickAddons } from "./addons.server";

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
  // A tick that is still running when the next one is due is skipped, never run twice at once.
  s.timer = setInterval(() => { void jobs().run("scheduler-tick", () => tick(s), { timeoutMs: 150_000 }); }, 30_000);
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

/** Quick checks run side by side, each guarded against overlap and a hang. Long work (backup, model answers) is started
 *  but not waited for, so a slow model can never hold up reminders or alerts. Model work shares one lane (one at a time). */
async function tick(s: S): Promise<void> {
  const now = new Date();
  const ms = now.getTime();
  const j = jobs();
  const quick = { timeoutMs: 120_000 };
  const cfg = backupConfig();
  if (cfg && isDue(now, cfg.tz, cfg.time, s.lastBackupDay)) {
    s.lastBackupDay = zonedParts(now, cfg.tz).day;
    void j.run("backup", () => runBackup(cfg, now), { timeoutMs: 30 * 60_000 });
  }
  void j.run("schedules", () => tickSchedules(now), { timeoutMs: 60 * 60_000 }); // each task inside waits for the model lane
  const review = weeklyConfig();
  if (review && isReviewDay(now, review) && isDue(now, review.tz, review.time, s.lastReviewDay ?? "")) {
    s.lastReviewDay = zonedParts(now, review.tz).day;
    void j.run("weekly-review", async () => {
      const r = await sendWeekly();
      if (!r.ok) logServer("warn", "Weekly review not sent: no phone push configured");
    }, { timeoutMs: 15 * 60_000, lane: "inference" });
  }
  const brief = briefConfig();
  if (brief && isDue(now, brief.tz, brief.time, s.lastBriefDay)) {
    s.lastBriefDay = zonedParts(now, brief.tz).day;
    void j.run("morning-brief", async () => {
      const r = await sendBrief();
      if (!r.ok) logServer("warn", `Morning brief not sent: ${r.error}`);
    }, { timeoutMs: 15 * 60_000, lane: "inference" });
  }
  await Promise.allSettled([
    j.run("reminders", () => tickReminders(ms), quick),
    j.run("update-check", () => tickUpdate(ms), quick),
    j.run("caldav", () => tickCaldav(ms), quick),
    j.run("today", () => tickToday(ms), quick),
    j.run("playtests", () => tickPlaytests(ms), quick),
    j.run("mail-alerts", () => tickMailAlerts(ms), quick),
    j.run("addons", () => tickAddons(ms), quick),
  ]);
}

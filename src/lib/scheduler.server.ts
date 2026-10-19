import { backupAgeMs, backupConfig, runBackup } from "./backup.server";
import { isDue, zonedParts } from "./schedule";
import { logServer } from "./server-log.server";

/** One 30-second ticker for the daily jobs. Idempotent. Does nothing unless a job is configured. */
type S = { timer?: ReturnType<typeof setInterval>; lastBackupDay: string };
const holder = globalThis as unknown as { __buddyScheduler?: S };

export function startScheduler(): void {
  if (holder.__buddyScheduler?.timer) return;
  if (!backupConfig()) return;
  const s: S = (holder.__buddyScheduler ??= { lastBackupDay: "" });
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
}

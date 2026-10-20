import { ageText, parseHm, validZone, zonedParts } from "./schedule";
import { backupName, insideData, isBackupName, pruneList } from "./backup";
import { logServer } from "./server-log.server";

/**
 * Nightly copy of BUDDY_DATA_DIR (accounts, chats, settings) into BUDDY_BACKUP_DIR, keeping the newest BUDDY_BACKUP_KEEP.
 * Backups contain password hashes and API keys: point BUDDY_BACKUP_DIR at somewhere private (for example a mounted Unraid share).
 * Off unless both folders are set.
 */
export type BackupConfig = { dir: string; dataDir: string; keep: number; time: string; tz: string };
export type BackupStatus = { at: string; ok: boolean; name?: string; error?: string };
type Store = { last?: BackupStatus; running?: boolean; warned?: boolean };
const store = (globalThis as unknown as { __buddyBackup?: Store });
const state = (): Store => (store.__buddyBackup ??= {});

async function fs() {
  return (await import(/* @vite-ignore */ "node:" + "fs/promises")) as typeof import("node:fs/promises");
}

export function backupConfig(env: Record<string, string | undefined> = process.env): BackupConfig | null {
  const dir = (env["BUDDY_BACKUP_DIR"] ?? "").trim().replace(/\/+$/, "");
  const dataDir = (env["BUDDY_DATA_DIR"] ?? "").trim().replace(/\/+$/, "");
  if (!dir || !dataDir) return null;
  if (insideData(dir, dataDir)) {
    if (!state().warned) { state().warned = true; logServer("warn", "Backups are off: BUDDY_BACKUP_DIR must be outside BUDDY_DATA_DIR."); }
    return null;
  }
  const keep = Number(env["BUDDY_BACKUP_KEEP"]);
  const tz = validZone(env["BUDDY_TZ"]) ?? validZone(Intl.DateTimeFormat().resolvedOptions().timeZone) ?? "UTC";
  return { dir, dataDir, keep: Number.isFinite(keep) && keep >= 1 ? Math.min(365, Math.round(keep)) : 14, time: parseHm(env["BUDDY_BACKUP_TIME"], "03:30"), tz };
}

async function names(dir: string): Promise<string[]> {
  try { return (await (await fs()).readdir(dir)).filter(isBackupName).sort(); } catch { return []; }
}

export async function runBackup(cfg: BackupConfig, now = new Date()): Promise<BackupStatus> {
  const s = state();
  if (s.running) return { at: now.toISOString(), ok: false, error: "A backup is already running." };
  s.running = true;
  try {
    const f = await fs();
    const name = backupName(zonedParts(now, cfg.tz).stamp);
    const tmp = `${cfg.dir}/.partial-${name}`;
    const final = `${cfg.dir}/${name}`;
    await f.mkdir(cfg.dir, { recursive: true });
    await f.rm(tmp, { recursive: true, force: true });
    await f.cp(cfg.dataDir, tmp, { recursive: true, filter: (src: string) => !src.endsWith(".tmp") && !src.endsWith("/app-secrets.json") && !src.endsWith("/google-token.json") });
    await f.rm(final, { recursive: true, force: true });
    await f.rename(tmp, final);
    for (const old of pruneList(await names(cfg.dir), cfg.keep)) await f.rm(`${cfg.dir}/${old}`, { recursive: true, force: true });
    s.last = { at: now.toISOString(), ok: true, name };
    logServer("info", `Backup written: ${name}`);
  } catch (error) {
    s.last = { at: now.toISOString(), ok: false, error: error instanceof Error ? error.message.slice(0, 200) : "failed" };
    logServer("error", "Backup failed", error);
  } finally {
    s.running = false;
  }
  return s.last as BackupStatus;
}

/** Plain-text status for /backup, the debug report and the morning brief. */
export async function backupText(cfg: BackupConfig | null = backupConfig()): Promise<string> {
  if (!cfg) return "Backups are off. Set BUDDY_BACKUP_DIR (a folder outside the data folder, for example a mounted Unraid share) to turn them on.";
  const list = await names(cfg.dir);
  const newest = list[list.length - 1];
  let age = "";
  if (newest) { try { age = ageText(Date.now() - (await (await fs()).stat(`${cfg.dir}/${newest}`)).mtimeMs); } catch { /* ignore */ } }
  const last = state().last;
  const lines = [
    newest ? `Latest backup: ${newest}${age ? ` (${age})` : ""}. ${list.length} kept, up to ${cfg.keep}.` : "No backup has been made yet.",
    `Runs daily at ${cfg.time} (${cfg.tz}) into ${cfg.dir}.`,
  ];
  if (last && !last.ok) lines.push(`⚠ The last attempt failed: ${last.error}`);
  return lines.join("\n");
}

export async function backupAgeMs(cfg: BackupConfig): Promise<number | null> {
  const newest = (await names(cfg.dir)).pop();
  if (!newest) return null;
  try { return Date.now() - (await (await fs()).stat(`${cfg.dir}/${newest}`)).mtimeMs; } catch { return null; }
}

export async function listBackupNames(cfg: BackupConfig): Promise<string[]> {
  return names(cfg.dir);
}

/** Per-backup age text for the list. */
export async function backupAges(cfg: BackupConfig, list: string[]): Promise<Record<string, string>> {
  const out: Record<string, string> = {};
  for (const n of list) { try { out[n] = ageText(Date.now() - (await (await fs()).stat(`${cfg.dir}/${n}`)).mtimeMs); } catch { /* skip */ } }
  return out;
}

/**
 * Put a backup back. First saves what's there now as pre-restore-<time> (never pruned), then copies the backup over the data folder.
 * Files that exist now but not in the backup are left alone. Only names that really exist in the backup folder are accepted.
 */
export async function restoreBackup(cfg: BackupConfig, name: string, now = new Date()): Promise<{ ok: boolean; text: string }> {
  const s = state();
  if (s.running) return { ok: false, text: "A backup or restore is already running." };
  if (!isBackupName(name) || !(await names(cfg.dir)).includes(name)) return { ok: false, text: "That backup doesn't exist. /backup list shows them." };
  s.running = true;
  try {
    const f = await fs();
    const safety = `pre-restore-${zonedParts(now, cfg.tz).stamp}`;
    await f.cp(cfg.dataDir, `${cfg.dir}/${safety}`, { recursive: true, filter: (src: string) => !src.endsWith(".tmp") });
    await f.cp(`${cfg.dir}/${name}`, cfg.dataDir, { recursive: true, force: true });
    logServer("warn", `Restored backup ${name} (previous data saved as ${safety})`);
    return { ok: true, text: `Restored ${name}. What was there before is saved as ${safety} in the backup folder. Sign out and back in, and restart the container if anything looks stale.` };
  } catch (error) {
    logServer("error", "Restore failed", error);
    return { ok: false, text: `Restore failed: ${error instanceof Error ? error.message.slice(0, 160) : "error"}` };
  } finally {
    s.running = false;
  }
}

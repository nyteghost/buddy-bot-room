import { runMigrations, parseRecord, migrationText, type KV, type MigrationReport } from "./migrate";
import { SERVER_VERSION_FILE, serverMigrations } from "./migrations";
import { logServer } from "./server-log.server";

const dir = () => (process.env["BUDDY_DATA_DIR"] ?? "").trim().replace(/\/+$/, "");
const fsp = () => import(/* @vite-ignore */ "node:" + "fs/promises");
const holder = globalThis as unknown as { __ppMigration?: Promise<MigrationReport | null>; __ppMigrationReport?: MigrationReport | null };

/** Key/value view of the data folder: each key is a file name directly inside it (no sub-folders, no "..") . Writes are atomic. */
export function dataFolderKV(root: string): KV {
  const path = (key: string) => {
    if (!/^[\w.-]+$/.test(key) || key.startsWith("..")) throw new Error(`Not a data file name: ${key}`);
    return `${root}/${key}`;
  };
  return {
    async get(key) { try { return await (await fsp()).readFile(path(key), "utf8"); } catch { return null; } },
    async set(key, value) {
      const f = await fsp();
      const tmp = `${path(key)}.${process.pid}.tmp`;
      await f.writeFile(tmp, value, { mode: 0o600 });
      await f.rename(tmp, path(key));
    },
    async remove(key) { await (await fsp()).rm(path(key), { force: true }); },
  };
}

/** Runs once per process at start. With pending migrations and backups configured, a backup is taken first. Never throws. */
export function ensureMigrated(): Promise<MigrationReport | null> {
  return (holder.__ppMigration ??= (async () => {
    const root = dir();
    if (!root) return null;
    try {
      const kv = dataFolderKV(root);
      const rec = parseRecord(await kv.get(SERVER_VERSION_FILE));
      const last = serverMigrations[serverMigrations.length - 1]?.id ?? 0;
      if (rec.version < last || rec.pending) {
        try {
          const { backupConfig, runBackup } = await import("./backup.server");
          const cfg = backupConfig();
          if (cfg) { const b = await runBackup(cfg); logServer(b.ok ? "info" : "warn", b.ok ? `Backup before data migration: ${b.name}` : `Backup before data migration failed: ${b.error}`); }
        } catch { /* a missing backup setup must not block the app */ }
      }
      const report = await runMigrations(kv, serverMigrations, SERVER_VERSION_FILE);
      holder.__ppMigrationReport = report;
      if (report.ran.length) logServer("info", `Data migrated from v${report.from} to v${report.to}.`);
      if (report.failed) logServer("error", `Data migration ${report.failed.id} (${report.failed.name}) failed and was undone: ${report.failed.error}`);
      if (report.recovered) logServer("warn", `Data migration ${report.recovered} was interrupted last time; its files were restored.`);
      return report;
    } catch (e) {
      logServer("error", `Data migrations could not run: ${e instanceof Error ? e.message : "error"}`);
      return null;
    }
  })());
}

/** For the status screen: the data format version and anything that went wrong. */
export async function migrationStatusLine(): Promise<string | null> {
  const root = dir();
  if (!root) return null;
  await ensureMigrated();
  const rec = parseRecord(await dataFolderKV(root).get(SERVER_VERSION_FILE));
  return migrationText(holder.__ppMigrationReport ?? null, rec);
}

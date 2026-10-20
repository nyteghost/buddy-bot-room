/** Names and pruning for the nightly backup. Pure. */
const NAME = /^pixelpals-\d{4}-\d{2}-\d{2}-\d{4}$/;
export const backupName = (stamp: string): string => `pixelpals-${stamp}`;
export const isBackupName = (n: string): boolean => NAME.test(n);

/** Which backups to delete so only the newest `keep` remain. Ignores anything that isn't one of ours. */
export function pruneList(names: string[], keep: number): string[] {
  const ours = names.filter(isBackupName).sort();
  return ours.slice(0, Math.max(0, ours.length - Math.max(1, keep)));
}

/** True when `dir` is the data folder or inside it (a backup must never land inside what it copies). */
export function insideData(dir: string, data: string): boolean {
  const d = data.replace(/\/+$/, "");
  const b = dir.replace(/\/+$/, "");
  return b === d || b.startsWith(`${d}/`);
}

/** "latest" or "" → newest, "2" → second newest, or an exact name. Undefined when nothing matches. */
export function pickBackup(names: string[], query: string): string | undefined {
  const ours = names.filter(isBackupName).sort().reverse();
  const q = query.trim().toLowerCase();
  if (!q || q === "latest" || q === "newest") return ours[0];
  if (/^\d{1,3}$/.test(q)) return ours[Number(q) - 1];
  return ours.find((n) => n === q);
}

/** Numbered list for /backup list, newest first, so "restore 2" is easy to say. */
export function backupListText(names: string[], ages: Record<string, string> = {}): string {
  const ours = names.filter(isBackupName).sort().reverse();
  if (!ours.length) return "No backups yet. /backup now makes one.";
  return ["Backups, newest first:", ...ours.slice(0, 20).map((n, i) => `${i + 1}. ${n}${ages[n] ? ` (${ages[n]})` : ""}`), "", "Restore one with /backup restore <number or name>."].join("\n");
}

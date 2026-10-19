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

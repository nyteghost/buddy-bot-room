import { accountsEnabled } from "./accounts";
import { currentUser } from "./accounts.server";
import { backupConfig, backupText, runBackup } from "./backup.server";

/** GET = status text; POST = back up now (owner only when accounts are on). */
export async function handleBackup(request: Request) {
  if (accountsEnabled(process.env)) {
    const user = await currentUser(request);
    if (!user?.owner) return Response.json({ error: "Only the owner can use backups." }, { status: 403 });
  }
  const cfg = backupConfig();
  if (request.method === "POST") {
    if (!cfg) return Response.json({ ok: false, text: await backupText(null) });
    const result = await runBackup(cfg);
    return Response.json({ ok: result.ok, text: result.ok ? `Backup done: ${result.name}.\n${await backupText(cfg)}` : `Backup failed: ${result.error}` });
  }
  return Response.json({ ok: true, text: await backupText(cfg) });
}

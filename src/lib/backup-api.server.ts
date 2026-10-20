import { accountsEnabled } from "./accounts";
import { currentUser } from "./accounts.server";
import { backupAges, backupConfig, backupText, listBackupNames, restoreBackup, runBackup } from "./backup.server";
import { backupListText, pickBackup } from "./backup";

/** GET = status text; POST = back up now (owner only when accounts are on). */
export async function handleBackup(request: Request) {
  if (accountsEnabled(process.env)) {
    const user = await currentUser(request);
    if (!user?.owner) return Response.json({ error: "Only the owner can use backups." }, { status: 403 });
  }
  const cfg = backupConfig();
  const body = request.method === "POST" ? ((await request.json().catch(() => ({}))) as { op?: string; name?: string; confirm?: boolean }) : {};
  if (body.op === "list" || body.op === "restore") {
    if (!cfg) return Response.json({ ok: false, text: await backupText(null) });
    const all = await listBackupNames(cfg);
    if (body.op === "list") { const ages = await backupAges(cfg, all); return Response.json({ ok: true, text: backupListText(all, ages), names: all.slice(-12).reverse(), ages }); }
    const name = pickBackup(all, String(body.name ?? ""));
    if (!name) return Response.json({ ok: false, text: "No backup matches that. /backup list shows them." });
    if (body.confirm !== true) return Response.json({ ok: false, text: `This will copy ${name} over your current data (accounts, saved chats, settings). Your current data is saved first as pre-restore-<time>, but anyone signed in may need to sign in again.\n\nTo go ahead, type: /backup restore ${name} confirm` });
    return Response.json(await restoreBackup(cfg, name));
  }
  if (request.method === "POST") {
    if (!cfg) return Response.json({ ok: false, text: await backupText(null) });
    const result = await runBackup(cfg);
    return Response.json({ ok: result.ok, text: result.ok ? `Backup done: ${result.name}.\n${await backupText(cfg)}` : `Backup failed: ${result.error}` });
  }
  return Response.json({ ok: true, text: await backupText(cfg) });
}

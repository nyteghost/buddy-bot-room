import { parseFetchHeaders, parseSearch, validFolder, type MailHeader } from "./imap";
import { withImap } from "./imap-client.server";

/**
 * Read-only unread mail over IMAP (EXAMINE + header-only BODY.PEEK, so nothing is marked read and bodies are never downloaded).
 * Address and credentials come only from the server's environment. For Gmail/Outlook/iCloud/Fastmail use an app password.
 */
export type ImapConfig = { host: string; port: number; user: string; pass: string; folder: string };

export function imapConfig(env: Record<string, string | undefined> = process.env): ImapConfig | null {
  const host = (env["IMAP_HOST"] ?? "").trim();
  const user = (env["IMAP_USER"] ?? "").trim();
  const pass = env["IMAP_PASS"] ?? "";
  const port = Number(env["IMAP_PORT"]) || 993;
  const folder = (env["IMAP_FOLDER"] ?? "INBOX").trim() || "INBOX";
  if (!/^[A-Za-z0-9.-]{1,253}$/.test(host) || !user || !pass || !validFolder(folder) || port < 1 || port > 65535) return null;
  return { host, port, user, pass, folder };
}

export async function fetchUnread(cfg: ImapConfig, limit = 12): Promise<MailHeader[]> {
  // EXAMINE keeps this read-only: nothing is marked read and bodies are never downloaded. Runs on the shared connection pool.
  return withImap(cfg, async (c) => {
    await c.cmd(`EXAMINE "${cfg.folder}"`);
    const ids = parseSearch(await c.cmd("SEARCH UNSEEN")).slice(-limit);
    return ids.length ? parseFetchHeaders(await c.cmd(`FETCH ${ids.join(",")} (BODY.PEEK[HEADER.FIELDS (FROM SUBJECT DATE)])`)).reverse() : [];
  });
}

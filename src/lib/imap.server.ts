import { imapQuote, parseFetchHeaders, parseSearch, validFolder, type MailHeader } from "./imap";

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
  const tls = (await import(/* @vite-ignore */ "node:" + "tls")) as typeof import("node:tls");
  const user = imapQuote(cfg.user);
  const pass = imapQuote(cfg.pass);
  if (!user || !pass) throw new Error("bad credentials");
  return new Promise<MailHeader[]>((resolve, reject) => {
    const socket = tls.connect({ host: cfg.host, port: cfg.port, servername: cfg.host });
    socket.setEncoding("latin1");
    const tag = `pp${Math.random().toString(36).slice(2, 6)}`;
    let n = 0;
    let buf = "";
    let waiting: { tag: string; done: (reply: string, ok: boolean) => void } | null = null;
    let greeted = false;
    const timer = setTimeout(() => { socket.destroy(); reject(new Error("timed out")); }, 15_000);
    const finish = (err: Error | null, value?: MailHeader[]) => { clearTimeout(timer); socket.destroy(); err ? reject(err) : resolve(value ?? []); };
    const send = (cmd: string) => new Promise<string>((res, rej) => {
      const t = `${tag}${++n}`;
      waiting = { tag: t, done: (reply, ok) => (ok ? res(reply) : rej(new Error(/ (NO|BAD)\b ?(.*)$/m.exec(reply)?.[0]?.slice(0, 100) ?? "command failed"))) };
      socket.write(`${t} ${cmd}\r\n`, "latin1");
    });
    const check = () => {
      if (buf.length > 2_000_000) return finish(new Error("reply too large"));
      if (!greeted) { if (/^\* (OK|PREAUTH)/.test(buf) && buf.includes("\r\n")) { greeted = true; buf = ""; void run(); } return; }
      if (!waiting) return;
      const m = new RegExp(`\\r?\\n?${waiting.tag} (OK|NO|BAD)[^\\r\\n]*\\r\\n`).exec(buf);
      if (m) { const w = waiting; waiting = null; const reply = buf.slice(0, m.index + m[0].length); buf = buf.slice(m.index + m[0].length); w.done(reply, m[1] === "OK"); }
    };
    socket.on("data", (d: string) => { buf += d; check(); });
    socket.on("error", (e) => finish(e));
    socket.on("close", () => { if (waiting) finish(new Error("connection closed")); });
    async function run() {
      try {
        await send(`LOGIN ${user} ${pass}`);
        await send(`EXAMINE "${cfg.folder}"`);
        const ids = parseSearch(await send("SEARCH UNSEEN")).slice(-limit);
        let items: MailHeader[] = [];
        if (ids.length) items = parseFetchHeaders(await send(`FETCH ${ids.join(",")} (BODY.PEEK[HEADER.FIELDS (FROM SUBJECT DATE)])`)).reverse();
        void send("LOGOUT").catch(() => undefined);
        finish(null, items);
      } catch (e) { finish(e instanceof Error ? e : new Error("failed")); }
    }
  });
}

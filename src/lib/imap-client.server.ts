import { imapQuote } from "./imap";
import type { ImapConfig } from "./imap.server";

/**
 * A small IMAP session over TLS for the mailbox (list, read, move, delete, mark). One connection per request,
 * closed when the work is done. Replies are read as latin1 so literal lengths are byte counts.
 */
export type ImapClient = { cmd: (command: string) => Promise<string>; append: (mailboxQuoted: string, raw: string) => Promise<string>; capabilities: string };

export type TlsOverrides = { rejectUnauthorized?: boolean };

export async function withImap<T>(cfg: ImapConfig, work: (c: ImapClient) => Promise<T>, tlsOverrides: TlsOverrides = {}): Promise<T> {
  const tls = (await import(/* @vite-ignore */ "node:" + "tls")) as typeof import("node:tls");
  const user = imapQuote(cfg.user);
  const pass = imapQuote(cfg.pass);
  if (!user || !pass) throw new Error("bad credentials");
  return new Promise<T>((resolve, reject) => {
    const socket = tls.connect({ host: cfg.host, port: cfg.port, servername: cfg.host, ...tlsOverrides });
    socket.setEncoding("latin1");
    const tag = `pp${Math.random().toString(36).slice(2, 6)}`;
    let n = 0;
    let buf = "";
    let waiting: { tag: string; done: (reply: string, ok: boolean) => void; literal?: string | undefined } | null = null;
    let greeted = false;
    let settled = false;
    const timer = setTimeout(() => settle(new Error("timed out")), 25_000);
    function settle(err: Error | null, value?: T) {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      socket.destroy();
      err ? reject(err) : resolve(value as T);
    }
    const cmd = (command: string) => new Promise<string>((res, rej) => {
      const t = `${tag}${++n}`;
      waiting = { tag: t, done: (reply, ok) => (ok ? res(reply) : rej(new Error(/ (NO|BAD)\b ?(.*)$/m.exec(reply)?.[2]?.slice(0, 120) || "command failed"))) };
      socket.write(`${t} ${command}\r\n`, "latin1");
    });
    /** APPEND with a synchronising literal: send the command, wait for the server's "+", then send the message. */
    const append = (mailboxQuoted: string, raw: string) => new Promise<string>((res, rej) => {
      const t = `${tag}${++n}`;
      waiting = { tag: t, literal: raw, done: (reply, ok) => (ok ? res(reply) : rej(new Error(/ (NO|BAD)\b ?(.*)$/m.exec(reply)?.[2]?.slice(0, 120) || "command failed"))) };
      socket.write(`${t} APPEND ${mailboxQuoted} (\\Seen) {${raw.length}}\r\n`, "latin1");
    });
    const check = () => {
      if (buf.length > 4_000_000) return settle(new Error("reply too large"));
      if (!greeted) { if (/^\* (OK|PREAUTH)/.test(buf) && buf.includes("\r\n")) { greeted = true; buf = ""; void run(); } return; }
      if (!waiting) return;
      if (waiting.literal !== undefined && /^\+/m.test(buf)) { const lit = waiting.literal; waiting.literal = undefined; buf = ""; socket.write(`${lit}\r\n`, "latin1"); return; }
      const m = new RegExp(`(?:^|\\r\\n)${waiting.tag} (OK|NO|BAD)[^\\r\\n]*\\r\\n`).exec(buf);
      if (m) { const w = waiting; waiting = null; const reply = buf.slice(0, m.index + m[0].length); buf = buf.slice(m.index + m[0].length); w.done(reply, m[1] === "OK"); }
    };
    socket.on("data", (d: string) => { buf += d; check(); });
    socket.on("error", (e) => settle(e));
    socket.on("close", () => { if (!settled) settle(new Error("connection closed")); });
    async function run() {
      try {
        await cmd(`LOGIN ${user} ${pass}`);
        const caps = await cmd("CAPABILITY").catch(() => "");
        const out = await work({ cmd, append, capabilities: caps.toUpperCase() });
        void cmd("LOGOUT").catch(() => undefined);
        settle(null, out);
      } catch (e) { settle(e instanceof Error ? e : new Error("failed")); }
    }
  });
}

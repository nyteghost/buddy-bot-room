import { authPlain, base64Bytes, dotStuff, guessSmtpHost, parseSmtpReply, validAddress } from "./mailbox";

/**
 * Sending mail over SMTP with the same account as the mailbox (IMAP_USER / IMAP_PASS). Port 465 uses TLS straight away
 * (Gmail's default); other ports start plain and upgrade with STARTTLS (587). Nothing is stored; one connection per message.
 */
/** implicitTls: encrypted from the first byte (port 465). Otherwise the connection starts plain and must upgrade with STARTTLS. */
export type SmtpConfig = { host: string; port: number; user: string; pass: string; from: string; name: string; implicitTls: boolean };
export type SmtpTlsOverrides = { rejectUnauthorized?: boolean };

export function smtpConfig(env: Record<string, string | undefined> = process.env): SmtpConfig | null {
  const imapHost = (env["IMAP_HOST"] ?? "").trim();
  const user = (env["IMAP_USER"] ?? "").trim();
  const pass = env["IMAP_PASS"] ?? "";
  const host = (env["SMTP_HOST"] ?? "").trim() || (imapHost ? guessSmtpHost(imapHost) : "");
  const port = Number(env["SMTP_PORT"]) || 465;
  if (!/^[A-Za-z0-9.-]{1,253}$/.test(host) || !user || !pass || !validAddress(user) || port < 1 || port > 65535) return null;
  return { host, port, user, pass, from: user, name: (env["MAIL_FROM_NAME"] ?? "").trim().slice(0, 80), implicitTls: port === 465 };
}

type Conn = { say: (line: string) => void; reply: () => Promise<{ code: number; text: string }>; upgrade: () => Promise<void>; close: () => void };

async function connect(cfg: SmtpConfig, overrides: SmtpTlsOverrides): Promise<Conn> {
  const tls = (await import(/* @vite-ignore */ "node:" + "tls")) as typeof import("node:tls");
  const net = (await import(/* @vite-ignore */ "node:" + "net")) as typeof import("node:net");
  type Sock = import("node:net").Socket;
  let socket: Sock = cfg.implicitTls
    ? (tls.connect({ host: cfg.host, port: cfg.port, servername: cfg.host, ...overrides }) as unknown as Sock)
    : net.connect({ host: cfg.host, port: cfg.port });
  let buf = "";
  let waiter: { resolve: (r: { code: number; text: string }) => void; reject: (e: Error) => void } | null = null;
  let failure: Error | null = null;
  const pump = () => {
    if (!waiter) return;
    const r = parseSmtpReply(buf);
    if (r) { buf = r.rest; const w = waiter; waiter = null; w.resolve({ code: r.code, text: r.text }); }
    else if (buf.length > 200_000) { const w = waiter; waiter = null; w.reject(new Error("reply too large")); }
  };
  const hook = (s: Sock) => {
    s.setEncoding("utf8");
    s.on("data", (d: string) => { buf += d; pump(); });
    s.on("error", (e: Error) => { failure = e; if (waiter) { const w = waiter; waiter = null; w.reject(e); } });
    s.on("close", () => { if (!failure) failure = new Error("connection closed"); if (waiter) { const w = waiter; waiter = null; w.reject(failure); } });
  };
  hook(socket);
  return {
    say: (line) => { socket.write(`${line}\r\n`); },
    reply: () => new Promise((resolve, reject) => {
      if (failure) return reject(failure);
      waiter = { resolve, reject };
      pump();
    }),
    upgrade: async () => {
      socket.removeAllListeners("data");
      const secured = tls.connect({ socket, servername: cfg.host, ...overrides }) as unknown as Sock;
      socket = secured;
      buf = "";
      hook(secured);
      await new Promise<void>((res, rej) => { secured.once("secureConnect", () => res()); secured.once("error", rej); });
    },
    close: () => socket.destroy(),
  };
}

const expect = (r: { code: number; text: string }, ok: number[], what: string) => {
  if (!ok.includes(r.code)) throw new Error(`${what}: ${r.code} ${r.text.split("\n")[0]?.slice(0, 120) ?? ""}`.trim());
};

/** Connects and signs in (and sends, when a message is given). Without a message it is a safe check: nothing is sent. */
async function session(cfg: SmtpConfig, message: { to: string[]; raw: string } | null, overrides: SmtpTlsOverrides): Promise<void> {
  const c = await connect(cfg, overrides);
  const timer = setTimeout(() => c.close(), 30_000);
  try {
    expect(await c.reply(), [220], "The mail server didn't greet us");
    c.say("EHLO pixelpals.local");
    let ehlo = await c.reply();
    expect(ehlo, [250], "EHLO");
    if (!cfg.implicitTls && /STARTTLS/i.test(ehlo.text)) {
      c.say("STARTTLS");
      expect(await c.reply(), [220], "STARTTLS");
      await c.upgrade();
      c.say("EHLO pixelpals.local");
      ehlo = await c.reply();
      expect(ehlo, [250], "EHLO");
    } else if (!cfg.implicitTls) {
      throw new Error("This server doesn't offer an encrypted connection, so the password was not sent.");
    }
    if (/AUTH[ =].*PLAIN/i.test(ehlo.text)) {
      c.say(`AUTH PLAIN ${authPlain(cfg.user, cfg.pass)}`);
      expect(await c.reply(), [235], "Sign-in refused (use an app password)");
    } else {
      c.say("AUTH LOGIN");
      expect(await c.reply(), [334], "AUTH");
      c.say(base64Bytes(new TextEncoder().encode(cfg.user)));
      expect(await c.reply(), [334], "AUTH");
      c.say(base64Bytes(new TextEncoder().encode(cfg.pass)));
      expect(await c.reply(), [235], "Sign-in refused (use an app password)");
    }
    if (message) {
      c.say(`MAIL FROM:<${cfg.from}>`);
      expect(await c.reply(), [250], "Sender refused");
      for (const to of message.to) {
        c.say(`RCPT TO:<${to}>`);
        expect(await c.reply(), [250, 251], `Recipient ${to} refused`);
      }
      c.say("DATA");
      expect(await c.reply(), [354], "DATA");
      c.say(dotStuff(message.raw).replace(/\r\n$/, ""));
      expect(await c.reply(), [250], "The server didn't accept the message");
    }
    c.say("QUIT");
  } finally { clearTimeout(timer); c.close(); }
}

export const smtpCheck = (cfg: SmtpConfig, overrides: SmtpTlsOverrides = {}) => session(cfg, null, overrides);
export const smtpSend = (cfg: SmtpConfig, message: { to: string[]; raw: string }, overrides: SmtpTlsOverrides = {}) => session(cfg, message, overrides);

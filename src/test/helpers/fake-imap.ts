import { execFileSync } from "node:child_process";
import { mkdtempSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import tls from "node:tls";
import type { AddressInfo } from "node:net";

/**
 * A small in-memory IMAP server over TLS for tests and benchmarks. It speaks enough of the protocol for Pixel Pals' mailbox:
 * LOGIN, CAPABILITY, LIST, SELECT/EXAMINE, SEARCH and UID SEARCH, FETCH and UID FETCH (headers or whole message), STORE, COPY, MOVE,
 * EXPUNGE, APPEND, CREATE, NOOP, LOGOUT. `rttMs` adds a delay to every reply and twice that before the greeting (TCP + TLS handshake),
 * so connection cost shows up the way it does on a real network. This is a SIMULATION: it never measures a real provider.
 */
export type FakeMessage = { uid: number; flags: string[]; from: string; to: string; subject: string; date: string; body: string; messageId: string };
export type FakeFolder = { name: string; attrs?: string; uidvalidity: number; uidnext: number; messages: FakeMessage[] };
export type FakeOptions = { user?: string; pass?: string; rttMs?: number; maxConnections?: number; idleKillMs?: number };

let cached: { key: string; cert: string } | undefined;
export function pem(): { key: string; cert: string } {
  if (cached) return cached;
  const made = mkdtempSync(join(tmpdir(), "pp-cert-"));
  execFileSync("openssl", ["req", "-x509", "-newkey", "rsa:2048", "-nodes", "-keyout", join(made, "key.pem"), "-out", join(made, "cert.pem"), "-days", "2", "-subj", "/CN=localhost"], { stdio: "ignore" });
  cached = { key: readFileSync(join(made, "key.pem"), "utf8"), cert: readFileSync(join(made, "cert.pem"), "utf8") };
  return cached;
}

export function makeMessages(n: number, startUid = 1, seed = "m"): FakeMessage[] {
  return Array.from({ length: n }, (_, i) => {
    const uid = startUid + i;
    const d = new Date(Date.UTC(2026, 9, 1, 12, 0, 0) + uid * 60_000).toUTCString();
    return { uid, flags: uid % 3 === 0 ? [] : ["\\Seen"], from: `Sender ${uid % 17} <s${uid % 17}@example.com>`, to: "me@example.com", subject: `${seed} subject ${uid}`, date: d, messageId: `<${seed}-${uid}@example.com>`, body: `Hello ${uid}.\r\n${"Lorem ipsum dolor sit amet. ".repeat(40)}\r\n` };
  });
}

export class FakeImapServer {
  readonly user: string;
  readonly pass: string;
  rttMs: number;
  maxConnections: number;
  idleKillMs: number;
  folders = new Map<string, FakeFolder>();
  connections = 0;
  logins = 0;
  failedLogins = 0;
  open = 0;
  maxOpen = 0;
  commands: { conn: number; cmd: string }[] = [];
  bytesSent = 0;
  rejectNext = 0;
  /** When true the server reads commands but never answers (a hung provider). */
  stall = false;
  private sockets = new Set<tls.TLSSocket>();
  private server!: tls.Server;
  port = 0;

  constructor(o: FakeOptions = {}) {
    this.user = o.user ?? "me@example.com";
    this.pass = o.pass ?? "app-password";
    this.rttMs = o.rttMs ?? 0;
    this.maxConnections = o.maxConnections ?? 100;
    this.idleKillMs = o.idleKillMs ?? 0;
    this.addFolder("INBOX", makeMessages(60));
    this.addFolder("[Gmail]/Sent Mail", makeMessages(15, 1, "sent"), "\\Sent");
    this.addFolder("[Gmail]/Trash", [], "\\Trash");
    this.addFolder("[Gmail]/Spam", [], "\\Junk");
  }

  addFolder(name: string, messages: FakeMessage[], attrs = ""): FakeFolder {
    const f: FakeFolder = { name, attrs, uidvalidity: 1000, uidnext: (messages.at(-1)?.uid ?? 0) + 1, messages };
    this.folders.set(name, f);
    return f;
  }

  async start(): Promise<this> {
    const { key, cert } = pem();
    this.server = tls.createServer({ key, cert }, (sock) => this.onConnection(sock));
    await new Promise<void>((r) => this.server.listen(0, "127.0.0.1", r));
    this.port = (this.server.address() as AddressInfo).port;
    return this;
  }
  async stop(): Promise<void> {
    this.dropAll();
    await new Promise<void>((r) => this.server.close(() => r()));
  }
  /** Simulates a network drop: every open connection is cut without a goodbye. */
  dropAll(): void { for (const s of this.sockets) s.destroy(); }
  get loginCommands(): number { return this.commands.filter((c) => c.cmd.startsWith("LOGIN")).length; }
  count(prefix: string): number { return this.commands.filter((c) => c.cmd.toUpperCase().startsWith(prefix.toUpperCase())).length; }
  resetCounters(): void { this.connections = 0; this.logins = 0; this.failedLogins = 0; this.commands = []; this.bytesSent = 0; this.maxOpen = this.open; }

  private onConnection(sock: tls.TLSSocket): void {
    const id = ++this.connections;
    this.open++; this.maxOpen = Math.max(this.maxOpen, this.open);
    this.sockets.add(sock);
    sock.setEncoding("latin1");
    sock.on("error", () => undefined);
    sock.on("close", () => { this.open--; this.sockets.delete(sock); clearTimeout(idle); });
    let idle: ReturnType<typeof setTimeout> | undefined;
    const armIdle = () => { if (!this.idleKillMs) return; clearTimeout(idle); idle = setTimeout(() => { sock.write("* BYE idle timeout\r\n", "latin1"); sock.end(); }, this.idleKillMs); };
    const send = (text: string, delay = this.rttMs) => {
      this.bytesSent += text.length;
      if (delay > 0) setTimeout(() => { if (!sock.destroyed) sock.write(text, "latin1"); }, delay); else sock.write(text, "latin1");
    };
    let state: { auth: boolean; folder?: FakeFolder | undefined } = { auth: false };
    let buf = "";
    let literal: { tag: string; need: number; mailbox: string } | null = null;
    let chain = Promise.resolve();
    if (this.open > this.maxConnections) { send("* BYE too many connections\r\n"); setTimeout(() => sock.end(), this.rttMs + 5); return; }
    send("* OK IMAP4rev1 fake ready\r\n", this.rttMs * 2);
    armIdle();
    sock.on("data", (d: string) => {
      armIdle();
      buf += d;
      for (;;) {
        if (literal) {
          if (buf.length < literal.need + 2) return;
          const l = literal; literal = null; const raw = buf.slice(0, l.need); buf = buf.slice(l.need + 2);
          const f = this.folders.get(l.mailbox);
          if (f) f.messages.push({ uid: f.uidnext++, flags: ["\\Seen"], from: "x", to: "x", subject: (/^Subject: (.*)$/m.exec(raw)?.[1] ?? ""), date: new Date().toUTCString(), messageId: "<a@b>", body: raw });
          send(`${l.tag} OK APPEND completed\r\n`);
          continue;
        }
        const nl = buf.indexOf("\r\n");
        if (nl < 0) return;
        const line = buf.slice(0, nl); buf = buf.slice(nl + 2);
        const m = /^(\S+) (\S+)(?: (.*))?$/.exec(line);
        if (!m) continue;
        const [, tag, verb, rest = ""] = m as unknown as [string, string, string, string?];
        this.commands.push({ conn: id, cmd: `${verb} ${verb.toUpperCase() === "LOGIN" ? "***" : rest}`.trim() });
        const V = verb.toUpperCase();
        if (this.stall && V !== "LOGIN") continue;
        if (V === "APPEND") {
          const mm = /^"?([^"{]*?)"? (?:\([^)]*\) )?\{(\d+)\}$/.exec(rest);
          if (mm) { literal = { tag, need: Number(mm[2]), mailbox: mm[1] ?? "" }; send("+ go ahead\r\n", 0); continue; }
        }
        chain = chain.then(() => { this.handle(tag, V, rest, state, send, sock); });
      }
    });
  }

  private handle(tag: string, verb: string, rest: string, state: { auth: boolean; folder?: FakeFolder | undefined }, send: (t: string) => void, sock: tls.TLSSocket): void {
    const ok = (extra = "") => send(`${extra}${tag} OK ${verb} completed\r\n`);
    const no = (why: string) => send(`${tag} NO ${why}\r\n`);
    if (verb === "LOGIN") {
      const [u, p] = [...rest.matchAll(/"((?:[^"\\]|\\.)*)"/g)].map((x) => (x[1] ?? "").replace(/\\(.)/g, "$1"));
      if (this.rejectNext > 0) { this.rejectNext--; this.failedLogins++; return no("[AUTHENTICATIONFAILED] Invalid credentials (Failure)"); }
      if (u === this.user && p === this.pass) { state.auth = true; this.logins++; return ok(); }
      this.failedLogins++;
      return no("[AUTHENTICATIONFAILED] Invalid credentials (Failure)");
    }
    if (verb === "LOGOUT") { send("* BYE logging out\r\n"); ok(); setTimeout(() => sock.end(), this.rttMs + 2); return; }
    if (verb === "NOOP") return ok();
    if (!state.auth) return no("Not authenticated");
    if (verb === "CAPABILITY") return ok("* CAPABILITY IMAP4rev1 UIDPLUS MOVE\r\n");
    if (verb === "LIST") {
      const lines = [...this.folders.values()].map((f) => `* LIST (${f.attrs ? f.attrs + " " : ""}\\HasNoChildren) "/" "${f.name}"\r\n`).join("");
      return ok(lines);
    }
    if (verb === "CREATE") { const name = /"([^"]+)"/.exec(rest)?.[1] ?? rest; if (!this.folders.has(name)) this.addFolder(name, []); return ok(); }
    if (verb === "SELECT" || verb === "EXAMINE") {
      const name = (/^"((?:[^"\\]|\\.)*)"$/.exec(rest.trim())?.[1] ?? rest.trim()).replace(/\\(.)/g, "$1");
      const f = this.folders.get(name);
      if (!f) { state.folder = undefined; return no("Mailbox doesn't exist"); }
      state.folder = f;
      return send(`* ${f.messages.length} EXISTS\r\n* OK [UIDVALIDITY ${f.uidvalidity}] ok\r\n* OK [UIDNEXT ${f.uidnext}] ok\r\n${tag} OK [${verb === "SELECT" ? "READ-WRITE" : "READ-ONLY"}] ${verb} completed\r\n`);
    }
    const f = state.folder;
    if (!f) return no("No mailbox selected");
    const isUid = verb === "UID";
    let cmd = verb; let args = rest;
    if (isUid) { const mm = /^(\S+) ?(.*)$/.exec(rest); cmd = (mm?.[1] ?? "").toUpperCase(); args = mm?.[2] ?? ""; }
    if (cmd === "SEARCH") {
      let pool = f.messages;
      const crit = args.toUpperCase();
      if (crit.includes("UNSEEN")) pool = pool.filter((x) => !x.flags.includes("\\Seen"));
      const text = /(?:TEXT|FROM|SUBJECT) "((?:[^"\\]|\\.)*)"/i.exec(args)?.[1]?.toLowerCase();
      if (text) { const field = /^(TEXT|FROM|SUBJECT)/i.exec(args.slice(args.toUpperCase().search(/(TEXT|FROM|SUBJECT) "/)))?.[1]?.toUpperCase(); pool = pool.filter((x) => (field === "FROM" ? x.from : field === "SUBJECT" ? x.subject : `${x.from} ${x.subject} ${x.body}`).toLowerCase().includes(text)); }
      const uidRange = /UID (\d+):\*/i.exec(args); if (uidRange) pool = pool.filter((x) => x.uid >= Number(uidRange[1]));
      const ids = pool.map((x) => (isUid ? x.uid : f.messages.indexOf(x) + 1));
      return ok(`* SEARCH${ids.length ? " " + ids.join(" ") : ""}\r\n`);
    }
    if (cmd === "FETCH") {
      const mm = /^(\S+) \((.*)\)$/.exec(args);
      const set = mm?.[1] ?? ""; const items = mm?.[2] ?? "";
      const want = new Set<number>();
      for (const part of set.split(",")) {
        const [a, b] = part.split(":");
        const lo = Number(a); const hi = b === undefined ? lo : b === "*" ? Number.MAX_SAFE_INTEGER : Number(b);
        f.messages.forEach((x, i) => { const key = isUid ? x.uid : i + 1; if (key >= lo && key <= hi) want.add(i); });
      }
      const whole = /BODY\.PEEK\[\](?:<0\.(\d+)>)?/i.exec(items);
      let out = "";
      for (const i of [...want].sort((x, y) => x - y)) {
        const x = f.messages[i]!;
        const headerAll = `From: ${x.from}\r\nTo: ${x.to}\r\nSubject: ${x.subject}\r\nDate: ${x.date}\r\nMessage-ID: ${x.messageId}\r\n`;
        const headerFew = `From: ${x.from}\r\nSubject: ${x.subject}\r\nDate: ${x.date}\r\n`;
        const flags = `FLAGS (${x.flags.join(" ")})`;
        const uidPart = items.toUpperCase().includes("UID") || isUid ? `UID ${x.uid} ` : "";
        if (whole) { const text = `${headerAll}\r\n${x.body}`.slice(0, whole[1] ? Number(whole[1]) : undefined); out += `* ${i + 1} FETCH (${uidPart}${flags} BODY[] {${text.length}}\r\n${text})\r\n`; }
        else { const h = /FROM TO SUBJECT/i.test(items) ? headerAll : headerFew; out += `* ${i + 1} FETCH (${uidPart}${flags} BODY[HEADER.FIELDS (X)] {${h.length + 2}}\r\n${h}\r\n)\r\n`; }
      }
      return ok(out);
    }
    if (cmd === "STORE") {
      const [id, op, flagsRaw] = [/^(\d+)/.exec(args)?.[1], /([+-])FLAGS/.exec(args)?.[1], /\(([^)]*)\)/.exec(args)?.[1] ?? ""];
      const x = f.messages.find((y) => y.uid === Number(id));
      if (x) { const fl = flagsRaw.split(/\s+/).filter(Boolean); x.flags = op === "-" ? x.flags.filter((z) => !fl.includes(z)) : [...new Set([...x.flags, ...fl])]; }
      return ok();
    }
    if (cmd === "COPY" || cmd === "MOVE") {
      const mm = /^(\d+) "((?:[^"\\]|\\.)*)"$/.exec(args);
      const dest = mm && this.folders.get(mm[2]!.replace(/\\(.)/g, "$1"));
      const x = mm && f.messages.find((y) => y.uid === Number(mm[1]));
      if (!dest || !x) return no("No such message or folder");
      dest.messages.push({ ...x, uid: dest.uidnext++ });
      if (cmd === "MOVE") f.messages = f.messages.filter((y) => y !== x);
      return ok();
    }
    if (cmd === "EXPUNGE") { f.messages = f.messages.filter((y) => !y.flags.includes("\\Deleted")); return ok(); }
    return no(`${verb} not supported by the test server`);
  }
}

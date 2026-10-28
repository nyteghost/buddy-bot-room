import { imapQuote } from "./imap";
import type { ImapConfig } from "./imap.server";

/**
 * IMAP over TLS for the mailbox, with a small pool of signed-in connections per account.
 *
 * Why a pool: opening a connection costs a TCP + TLS handshake, a LOGIN and a CAPABILITY round trip before the first useful
 * command, and the Mail window used to pay that on every click. The app is a long-lived Bun/Node server, so connections can be
 * kept for a short while and reused. Rules that keep this safe:
 *  - A connection is leased to ONE operation at a time (`withImap`), so commands from different requests never interleave and the
 *    selected folder can't change underneath you. Every operation selects its own folder first; nothing relies on leftover state.
 *  - At most IMAP_POOL_MAX (default 2, 1 to 4) connections per account, so provider limits (Gmail allows 15) are respected.
 *    When all are busy the next operation waits its turn (up to 30 s) instead of opening more.
 *  - Idle connections are closed after IMAP_IDLE_SECONDS (default 90; 0 turns reuse off, which gives the old
 *    one-connection-per-request behaviour). A connection older than 10 minutes is retired. One that has been idle for more than
 *    10 s is checked with NOOP before reuse; a dead one is replaced silently.
 *  - A connection that timed out, errored, closed, or still had a command in flight is destroyed, never reused.
 *  - Pools are keyed by host, port, user and a hash of the password, so accounts never share a connection and a changed password
 *    drops the old connections. After a refused login the same credentials aren't retried for 30 s (providers lock accounts).
 *  - Credentials and sockets stay in this module. `ImapClient` exposes only `cmd`, `append`, `capabilities` and a non-secret `account` label.
 * Replies are read as latin1 so literal lengths are byte counts.
 */
export type ImapClient = { cmd: (command: string) => Promise<string>; append: (mailboxQuoted: string, raw: string) => Promise<string>; capabilities: string; account: string };

export type TlsOverrides = { rejectUnauthorized?: boolean };
export type PoolSettings = { max: number; idleMs: number };

/** Timeouts in milliseconds. Exported (mutable) only so tests can shorten them. */
export const imapTimeouts = { connect: 15_000, cmd: 25_000, op: 40_000, wait: 30_000, probeAfter: 10_000, probe: 5_000, maxAge: 10 * 60_000, authBackoff: 30_000 };

export function poolSettings(env: Record<string, string | undefined> = process.env): PoolSettings {
  const max = Math.min(4, Math.max(1, Math.floor(Number(env["IMAP_POOL_MAX"])) || 2));
  const raw = (env["IMAP_IDLE_SECONDS"] ?? "").trim();
  const secs = raw === "" || !Number.isFinite(Number(raw)) ? 90 : Math.min(1800, Math.max(0, Number(raw)));
  return { max, idleMs: secs * 1000 };
}

export type ImapStats = { connects: number; reuses: number; probes: number; probeFailures: number; retries: number; discarded: number; waits: number; open: number; idle: number; waiting: number };
type Counters = Omit<ImapStats, "open" | "idle" | "waiting">;

class AuthError extends Error {}

/** Idle timers must not keep the process alive (the DOM typings don't know Node's unref). */
const unrefTimer = (t: unknown): void => { (t as { unref?: () => void }).unref?.(); };

const errorText = (reply: string): string => / (NO|BAD)\b ?(.*)$/m.exec(reply)?.[2]?.slice(0, 120) || "command failed";

/** One signed-in connection. Commands are queued, so even a careless caller can't overlap two on the wire. */
class Conn {
  socket!: import("node:tls").TLSSocket;
  capabilities = "";
  closed = false;
  createdAt = Date.now();
  lastUsed = Date.now();
  idleTimer: ReturnType<typeof setTimeout> | undefined;
  inFlight = 0;
  /** What this lease has done so far (reset on every lease): lets a dropped idle connection be retried only when nothing was executed. */
  leaseDone = 0;
  leaseFirst = "";
  fresh = true;
  onClosed: (() => void) | undefined;
  private buf = "";
  private n = 0;
  private tag = `pp${Math.random().toString(36).slice(2, 6)}`;
  private waiting: { tag: string; literal?: string | undefined; done: (reply: string, ok: boolean) => void; abort: (e: Error) => void } | null = null;
  private chain: Promise<unknown> = Promise.resolve();
  private greeting: (() => void) | undefined;
  private greeted = false;

  static async open(cfg: ImapConfig, overrides: TlsOverrides, user: string, pass: string): Promise<Conn> {
    const tls = (await import(/* @vite-ignore */ "node:" + "tls")) as typeof import("node:tls");
    const c = new Conn();
    try {
      await new Promise<void>((resolve, reject) => {
        const timer = setTimeout(() => reject(new Error("timed out")), imapTimeouts.connect);
        c.greeting = () => { clearTimeout(timer); resolve(); };
        c.socket = tls.connect({ host: cfg.host, port: cfg.port, servername: cfg.host, ...overrides });
        c.socket.setEncoding("latin1");
        c.socket.on("data", (d: string) => { c.buf += d; c.check(); });
        c.socket.on("error", (e) => { clearTimeout(timer); c.fail(e); reject(e); });
        c.socket.on("close", () => { clearTimeout(timer); c.fail(new Error("connection closed")); reject(new Error("connection closed")); });
      });
      try { await c.run(`LOGIN ${user} ${pass}`, imapTimeouts.cmd); }
      catch (e) { if (!c.closed) throw new AuthError(e instanceof Error ? e.message : "login refused"); throw e; }
      c.capabilities = (await c.run("CAPABILITY", imapTimeouts.cmd).catch(() => "")).toUpperCase();
      return c;
    } catch (e) {
      c.destroy();
      throw e;
    }
  }

  private check(): void {
    if (this.buf.length > 4_000_000) return this.fail(new Error("reply too large"));
    if (!this.greeted) {
      if (/^\* (OK|PREAUTH)/.test(this.buf) && this.buf.includes("\r\n")) { this.greeted = true; this.buf = ""; this.greeting?.(); }
      else if (/^\* BYE/.test(this.buf)) this.fail(new Error(/^\* BYE ?(.*)\r?$/m.exec(this.buf)?.[1]?.slice(0, 120) || "the server refused the connection"));
      return;
    }
    const w = this.waiting;
    if (!w) {
      // Nothing is waiting: an unsolicited line. A BYE means the server is hanging up; anything else is dropped.
      if (/^\* BYE/m.test(this.buf)) this.fail(new Error("the server closed the connection"));
      else if (this.buf.length > 65_536) this.buf = "";
      return;
    }
    if (w.literal !== undefined && /^\+/m.test(this.buf)) { const lit = w.literal; w.literal = undefined; this.buf = ""; this.socket.write(`${lit}\r\n`, "latin1"); return; }
    const m = new RegExp(`(?:^|\\r\\n)${w.tag} (OK|NO|BAD)[^\\r\\n]*\\r\\n`).exec(this.buf);
    if (m) {
      this.waiting = null;
      const reply = this.buf.slice(0, m.index + m[0].length);
      this.buf = this.buf.slice(m.index + m[0].length);
      w.done(reply, m[1] === "OK");
    }
  }

  private run(command: string, timeoutMs: number, literal?: string): Promise<string> {
    if (this.closed) return Promise.reject(new Error("connection closed"));
    this.buf = ""; // whatever arrived while idle belongs to no command
    const t = `${this.tag}${++this.n}`;
    return new Promise<string>((resolve, reject) => {
      const timer = setTimeout(() => this.fail(new Error("timed out")), timeoutMs);
      this.waiting = {
        tag: t,
        literal,
        done: (reply, ok) => { clearTimeout(timer); ok ? resolve(reply) : reject(new Error(errorText(reply))); },
        abort: (e) => { clearTimeout(timer); reject(e); },
      };
      this.socket.write(literal === undefined ? `${t} ${command}\r\n` : `${t} APPEND ${command} (\\Seen) {${literal.length}}\r\n`, "latin1");
    });
  }

  private enqueue(fn: () => Promise<string>): Promise<string> {
    this.inFlight++;
    const p = this.chain.then(fn);
    this.chain = p.catch(() => undefined);
    return p.finally(() => { this.inFlight--; });
  }
  cmd(command: string, timeoutMs = imapTimeouts.cmd): Promise<string> {
    if (!this.leaseFirst) this.leaseFirst = command.split(" ")[0]!.toUpperCase();
    return this.enqueue(() => this.run(command, timeoutMs).then((r) => { this.leaseDone++; return r; }));
  }
  append(mailboxQuoted: string, raw: string): Promise<string> {
    if (!this.leaseFirst) this.leaseFirst = "APPEND";
    return this.enqueue(() => this.run(mailboxQuoted, imapTimeouts.cmd, raw).then((r) => { this.leaseDone++; return r; }));
  }

  /** Marks the connection unusable, stops its socket and fails whatever is waiting for a reply. */
  fail(err: Error): void {
    const w = this.waiting;
    this.waiting = null;
    this.destroy();
    w?.abort(err);
  }

  destroy(): void {
    if (this.closed) return;
    this.closed = true;
    clearTimeout(this.idleTimer);
    try { this.socket?.destroy(); } catch { /* already gone */ }
    this.onClosed?.();
  }

  /** Polite goodbye for connections we are retiring on purpose. */
  close(): void {
    if (this.closed) return;
    try { this.socket.write(`${this.tag}${++this.n} LOGOUT\r\n`, "latin1"); } catch { /* ignore */ }
    const t = setTimeout(() => { try { this.socket.destroy(); } catch { /* already gone */ } }, 1000);
    unrefTimer(t);
    this.closed = true;
    clearTimeout(this.idleTimer);
    this.onClosed?.();
  }

  client(account: string): ImapClient {
    return { cmd: (c) => this.cmd(c), append: (m, r) => this.append(m, r), capabilities: this.capabilities, account };
  }
}

type Waiter = { resolve: (c: Conn) => void; reject: (e: Error) => void; timer: ReturnType<typeof setTimeout> };
type Pool = { key: string; prefix: string; cfg: ImapConfig; overrides: TlsOverrides; idle: Conn[]; all: Set<Conn>; opening: number; pending: number; retired?: boolean; waiters: Waiter[]; authFailed?: { until: number; message: string } };
const g = globalThis as unknown as { __pixelImap?: { pools: Map<string, Pool>; counters: Counters } };
const state = (g.__pixelImap ??= { pools: new Map<string, Pool>(), counters: { connects: 0, reuses: 0, probes: 0, probeFailures: 0, retries: 0, discarded: 0, waits: 0 } });

async function sha(text: string): Promise<string> {
  const d = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(text));
  return [...new Uint8Array(d)].slice(0, 12).map((b) => b.toString(16).padStart(2, "0")).join("");
}

export function imapStats(): ImapStats {
  let open = 0; let idle = 0; let waiting = 0;
  for (const p of state.pools.values()) { open += p.all.size; idle += p.idle.length; waiting += p.waiters.length; }
  return { ...state.counters, open, idle, waiting };
}

/** Closes every pooled connection (shutdown, tests, or after the mail settings change). */
export function closeAllImap(): void {
  for (const p of state.pools.values()) {
    for (const w of p.waiters.splice(0)) { clearTimeout(w.timer); w.reject(new Error("mail connections were closed")); }
    for (const c of [...p.all]) c.close();
    p.all.clear(); p.idle.length = 0;
  }
  state.pools.clear();
}
if (typeof process !== "undefined" && typeof process.once === "function" && !(globalThis as { __pixelImapExit?: boolean }).__pixelImapExit) {
  (globalThis as { __pixelImapExit?: boolean }).__pixelImapExit = true;
  process.once("exit", () => { for (const p of state.pools.values()) for (const c of p.all) c.destroy(); });
}

/** An empty pool nobody is using is dropped, so pools never accumulate. `pending` counts operations that hold or await the pool. */
function sweep(pool: Pool): void {
  if (!pool.all.size && !pool.opening && !pool.pending && !pool.waiters.length && !(pool.authFailed && pool.authFailed.until > Date.now()) && state.pools.get(pool.key) === pool) state.pools.delete(pool.key);
}
function forget(pool: Pool, c: Conn): void {
  pool.all.delete(c);
  const i = pool.idle.indexOf(c);
  if (i >= 0) pool.idle.splice(i, 1);
  sweep(pool);
}

function adopt(pool: Pool, c: Conn): void {
  pool.all.add(c);
  c.onClosed = () => forget(pool, c);
}

async function openFor(pool: Pool, user: string, pass: string): Promise<Conn> {
  pool.opening++;
  try {
    const c = await Conn.open(pool.cfg, pool.overrides, user, pass);
    state.counters.connects++;
    adopt(pool, c);
    return c;
  } catch (e) {
    if (e instanceof AuthError) pool.authFailed = { until: Date.now() + imapTimeouts.authBackoff, message: e.message };
    throw e;
  } finally { pool.opening--; }
}

/** After a connection goes away, a waiting operation may now open its own. */
function pump(pool: Pool, max: number, user: string, pass: string): void {
  while (pool.waiters.length && pool.all.size + pool.opening < max) {
    const w = pool.waiters.shift()!;
    clearTimeout(w.timer);
    openFor(pool, user, pass).then(w.resolve, w.reject);
  }
}

async function acquire(cfg: ImapConfig, overrides: TlsOverrides, user: string, pass: string, set: PoolSettings): Promise<{ pool: Pool; conn: Conn }> {
  const pool = await poolFor(cfg, overrides);
  pool.pending++;
  try { return { pool, conn: await take(pool, user, pass, set) }; }
  catch (e) { pool.pending--; sweep(pool); throw e; }
}

async function poolFor(cfg: ImapConfig, overrides: TlsOverrides): Promise<Pool> {
  const prefix = `${cfg.host.toLowerCase()}:${cfg.port}:${cfg.user}`;
  const key = `${prefix}:${await sha(cfg.pass)}:${overrides.rejectUnauthorized === false ? "lax" : "strict"}`;
  for (const [k, p] of state.pools) if (p.prefix === prefix && k !== key) { p.retired = true; for (const c of p.idle.splice(0)) c.close(); state.pools.delete(k); } // password changed: idle ones go now, busy ones when they finish
  let pool = state.pools.get(key);
  if (!pool) { pool = { key, prefix, cfg: { ...cfg, pass: "" }, overrides, idle: [], all: new Set(), opening: 0, pending: 0, waiters: [] }; state.pools.set(key, pool); }
  return pool;
}

async function take(pool: Pool, user: string, pass: string, set: PoolSettings): Promise<Conn> {
  const now = Date.now();
  if (pool.authFailed) { if (pool.authFailed.until > now) throw new Error(`${pool.authFailed.message} (not retrying for a moment: check the mail password in Settings)`); delete pool.authFailed; }
  for (;;) {
    const c = pool.idle.pop();
    if (c) {
      clearTimeout(c.idleTimer);
      if (c.closed) continue;
      if (Date.now() - c.createdAt > imapTimeouts.maxAge) { state.counters.discarded++; c.close(); continue; }
      if (Date.now() - c.lastUsed > imapTimeouts.probeAfter) {
        state.counters.probes++;
        try { await c.cmd("NOOP", imapTimeouts.probe); } catch { state.counters.probeFailures++; c.destroy(); continue; }
      }
      c.socket.ref();
      state.counters.reuses++;
      return c;
    }
    if (pool.all.size + pool.opening < set.max) return openFor(pool, user, pass).then((c) => { c.socket.ref(); return c; });
    state.counters.waits++;
    return new Promise<Conn>((resolve, reject) => {
      const w: Waiter = { resolve, reject, timer: setTimeout(() => { const i = pool.waiters.indexOf(w); if (i >= 0) pool.waiters.splice(i, 1); reject(new Error("The mail connections are all busy. Try again in a moment.")); }, imapTimeouts.wait) };
      pool.waiters.push(w);
    });
  }
}

function release(pool: Pool, c: Conn, set: PoolSettings, user: string, pass: string): void {
  pool.pending--;
  if (c.inFlight > 0) c.destroy(); // an operation that let go mid-command leaves the protocol in an unknown state
  if (c.closed || set.idleMs === 0 || pool.retired) {
    c.close();
    forget(pool, c);
    pump(pool, set.max, user, pass);
    sweep(pool);
    return;
  }
  c.lastUsed = Date.now();
  const w = pool.waiters.shift();
  if (w) { clearTimeout(w.timer); w.resolve(c); return; }
  c.socket.unref();
  pool.idle.push(c);
  c.idleTimer = setTimeout(() => { c.close(); forget(pool, c); }, set.idleMs);
  unrefTimer(c.idleTimer);
}

/** Errors that mean the connection itself was gone (not that the server said no). */
const connectionLost = (e: unknown): boolean => e instanceof Error && /connection closed|ECONNRESET|EPIPE|ERR_STREAM|socket hang up|the server closed the connection/i.test(e.message);
/** Commands that change nothing: the only ones whose first attempt may be repeated on a fresh connection. */
const READ_ONLY_FIRST = /^(LIST|SELECT|EXAMINE|NOOP|CAPABILITY|STATUS|LSUB)$/;

/**
 * Runs `work` with exclusive use of one signed-in connection. The connection goes back to the pool afterwards.
 * If a REUSED connection turns out to be dead before the operation got anywhere (nothing completed, and the first command only reads),
 * the operation is repeated once on a fresh connection. Anything later is never repeated: a move, delete or flag change that may
 * have reached the server must not run twice.
 */
export async function withImap<T>(cfg: ImapConfig, work: (c: ImapClient) => Promise<T>, tlsOverrides: TlsOverrides = {}): Promise<T> {
  const user = imapQuote(cfg.user);
  const pass = imapQuote(cfg.pass);
  if (!user || !pass) throw new Error("bad credentials");
  const set = poolSettings();
  for (let attempt = 1; ; attempt++) {
    const { pool, conn } = await acquire(cfg, tlsOverrides, user, pass, set);
    const reused = !conn.fresh;
    conn.fresh = false;
    conn.leaseDone = 0; conn.leaseFirst = "";
    const deadline = setTimeout(() => conn.fail(new Error("timed out")), imapTimeouts.op);
    try {
      return await work(conn.client(`${cfg.user}@${cfg.host}`));
    } catch (e) {
      const retry = attempt === 1 && reused && connectionLost(e) && conn.leaseDone === 0 && READ_ONLY_FIRST.test(conn.leaseFirst);
      if (!retry) throw e;
      state.counters.retries++;
    } finally {
      clearTimeout(deadline);
      release(pool, conn, set, user, pass);
    }
  }
}

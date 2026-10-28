import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { closeAllImap, imapStats, imapTimeouts, poolSettings, withImap, type ImapClient } from "@/lib/imap-client.server";
import { fetchUnread } from "@/lib/imap.server";
import { FakeImapServer } from "./helpers/fake-imap";

const tlsOk = { rejectUnauthorized: false };
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const defaults = { ...imapTimeouts };
let srv: FakeImapServer;
const cfg = () => ({ host: "localhost", port: srv.port, user: srv.user, pass: srv.pass, folder: "INBOX" });
const ping = (c: ImapClient) => c.cmd("NOOP");
const op = (c = cfg()) => withImap(c, ping, tlsOk);

beforeAll(async () => { srv = await new FakeImapServer().start(); });
afterAll(async () => { closeAllImap(); await srv.stop(); });
beforeEach(() => { closeAllImap(); srv.resetCounters(); srv.stall = false; srv.rejectNext = 0; Object.assign(imapTimeouts, defaults); delete process.env["IMAP_POOL_MAX"]; delete process.env["IMAP_IDLE_SECONDS"]; });
afterEach(async () => { closeAllImap(); await sleep(10); });

describe("settings", () => {
  it("has safe defaults and clamps values", () => {
    expect(poolSettings({})).toEqual({ max: 2, idleMs: 90_000 });
    expect(poolSettings({ IMAP_POOL_MAX: "99", IMAP_IDLE_SECONDS: "99999" })).toEqual({ max: 4, idleMs: 1_800_000 });
    expect(poolSettings({ IMAP_POOL_MAX: "0", IMAP_IDLE_SECONDS: "0" })).toEqual({ max: 2, idleMs: 0 });
    expect(poolSettings({ IMAP_IDLE_SECONDS: "abc" }).idleMs).toBe(90_000);
  });
});

describe("connection reuse", () => {
  it("signs in once for many operations", async () => {
    for (let i = 0; i < 5; i++) await op();
    expect(srv.connections).toBe(1);
    expect(srv.logins).toBe(1);
    expect(imapStats().reuses).toBe(4);
  });
  it("opens a new connection for every operation when reuse is off", async () => {
    process.env["IMAP_IDLE_SECONDS"] = "0";
    for (let i = 0; i < 3; i++) await op();
    expect(srv.connections).toBe(3);
    await sleep(50);
    expect(srv.open).toBe(0);
  });
  it("keeps working after a command the server refuses", async () => {
    await expect(withImap(cfg(), (c) => c.cmd('SELECT "No Such Folder"'), tlsOk)).rejects.toThrow(/exist/i);
    await op();
    expect(srv.connections).toBe(1);
  });
  it("selecting a folder in one operation never leaks into the next", async () => {
    const list = async (folder: string) => withImap(cfg(), async (c) => { await c.cmd(`SELECT "${folder}"`); return c.cmd("UID SEARCH ALL"); }, tlsOk);
    const inbox = await list("INBOX");
    const sent = await list("[Gmail]/Sent Mail");
    const inboxAgain = await list("INBOX");
    expect(inbox.match(/ \d+/g)?.length).toBe(60);
    expect(sent.match(/ \d+/g)?.length).toBe(15);
    expect(inboxAgain.split("\r\n")[0]).toBe(inbox.split("\r\n")[0]);
    expect(srv.connections).toBe(1);
  });
  it("fetchUnread uses the pool, EXAMINE and no bodies", async () => {
    const prev = process.env["NODE_TLS_REJECT_UNAUTHORIZED"];
    process.env["NODE_TLS_REJECT_UNAUTHORIZED"] = "0"; // fetchUnread has no per-call TLS override; the test certificate is self-signed
    try {
      const a = await fetchUnread(cfg(), 5);
      const b = await fetchUnread(cfg(), 5);
      expect(a.length).toBe(5);
      expect(b).toEqual(a);
      expect(srv.connections).toBe(1);
      expect(srv.count("EXAMINE")).toBe(2);
      expect(srv.commands.some((c) => /BODY\.PEEK\[\]/.test(c.cmd))).toBe(false);
    } finally { if (prev === undefined) delete process.env["NODE_TLS_REJECT_UNAUTHORIZED"]; else process.env["NODE_TLS_REJECT_UNAUTHORIZED"] = prev; }
  });
});

describe("pool limits and concurrency", () => {
  it("never opens more than the limit and still finishes every operation", async () => {
    srv.rttMs = 5;
    const folders = ["INBOX", "[Gmail]/Sent Mail"];
    const results = await Promise.all(Array.from({ length: 10 }, (_, i) => withImap(cfg(), async (c) => { await c.cmd(`SELECT "${folders[i % 2]}"`); return c.cmd("UID SEARCH ALL"); }, tlsOk)));
    expect(srv.maxOpen).toBeLessThanOrEqual(2);
    results.forEach((r, i) => expect(r.match(/ \d+/g)?.length).toBe(i % 2 === 0 ? 60 : 15)); // each operation saw its own folder
    expect(imapStats().waits).toBeGreaterThan(0);
  });
  it("respects a limit of one", async () => {
    process.env["IMAP_POOL_MAX"] = "1";
    srv.rttMs = 3;
    await Promise.all(Array.from({ length: 6 }, () => op()));
    expect(srv.maxOpen).toBe(1);
    expect(srv.connections).toBe(1);
  });
  it("queues commands from one operation instead of interleaving them", async () => {
    srv.rttMs = 2;
    const out = await withImap(cfg(), (c) => Promise.all([c.cmd('SELECT "INBOX"'), c.cmd("UID SEARCH ALL"), c.cmd("NOOP")]), tlsOk);
    expect(out[0]).toMatch(/EXISTS/);
    expect(out[1]).toMatch(/\* SEARCH/);
    expect(out[2]).toMatch(/NOOP completed/);
  });
  it("gives up waiting for a busy pool with a clear message", async () => {
    process.env["IMAP_POOL_MAX"] = "1";
    imapTimeouts.wait = 60;
    const hold = withImap(cfg(), async (c) => { await sleep(300); return ping(c); }, tlsOk);
    await sleep(20);
    await expect(op()).rejects.toThrow(/busy/i);
    await hold;
  });
});

describe("idle cleanup and shutdown", () => {
  it("closes an idle connection after the timeout", async () => {
    process.env["IMAP_IDLE_SECONDS"] = "0.15";
    await op();
    expect(imapStats().idle).toBe(1);
    await sleep(400);
    expect(imapStats()).toMatchObject({ open: 0, idle: 0 });
    expect(srv.open).toBe(0);
  });
  it("closes everything on shutdown and starts clean afterwards", async () => {
    await op();
    closeAllImap();
    expect(imapStats().open).toBe(0);
    await sleep(60);
    expect(srv.open).toBe(0);
    await op();
    expect(srv.connections).toBe(2);
  });
  it("retires connections that are too old", async () => {
    imapTimeouts.maxAge = 20;
    await op(); await sleep(40); await op();
    expect(srv.connections).toBe(2);
    expect(imapStats().discarded).toBe(1);
  });
});

describe("failures and reconnection", () => {
  it("replaces a connection the network dropped", async () => {
    await op();
    srv.dropAll();
    await sleep(40);
    await op();
    expect(srv.connections).toBe(2);
  });
  it("notices a dead connection with a health check before reuse", async () => {
    imapTimeouts.probeAfter = -1; // always check
    await op();
    srv.dropAll();
    await op(); // the close event may not have arrived yet, so the NOOP check has to catch it
    expect(srv.connections).toBe(2);
    expect(imapStats().probes + imapStats().retries).toBeGreaterThan(0);
  });
  it("repeats a read-only operation once when a reused connection was dead without anyone noticing", async () => {
    await op();
    srv.dropAll();
    const out = await withImap(cfg(), async (c) => { await c.cmd('SELECT "INBOX"'); return c.cmd("UID SEARCH ALL"); }, tlsOk);
    expect(out).toMatch(/\* SEARCH/);
    expect(srv.connections).toBe(2);
  });
  it("never repeats an operation that may already have changed something", async () => {
    await op();
    srv.dropAll();
    let ran = 0;
    await expect(withImap(cfg(), async (c) => { ran++; await c.cmd('SELECT "INBOX"'); await c.cmd("UID STORE 1 +FLAGS.SILENT (\\Deleted)"); srv.dropAll(); await c.cmd("UID EXPUNGE 1"); }, tlsOk)).rejects.toThrow();
    expect(ran).toBeLessThanOrEqual(2);
    expect(srv.count("UID EXPUNGE")).toBeLessThanOrEqual(1);
  });
  it("does not reuse a connection that timed out", async () => {
    imapTimeouts.cmd = 80;
    await op();
    srv.stall = true;
    await expect(op()).rejects.toThrow(/timed out/);
    srv.stall = false;
    await sleep(20);
    await op();
    expect(srv.connections).toBe(2);
    expect(imapStats().open).toBe(1);
  });
  it("destroys a connection when an operation lets go with a command still running", async () => {
    srv.rttMs = 30;
    await withImap(cfg(), async (c) => { void c.cmd("NOOP").catch(() => undefined); }, tlsOk);
    await op();
    expect(srv.connections).toBe(2);
  });
  it("rejects when the server hangs up with BYE (provider connection limit)", async () => {
    srv.maxConnections = 0;
    await expect(op()).rejects.toThrow(/too many|closed/i);
    srv.maxConnections = 100;
    await op();
    expect(imapStats().open).toBe(1);
  });
  it("operation deadline ends an operation that never finishes and frees the connection", async () => {
    imapTimeouts.op = 60;
    await expect(withImap(cfg(), async (c) => { await ping(c); await sleep(200); return ping(c); }, tlsOk)).rejects.toThrow();
    imapTimeouts.op = defaults.op;
    await op();
    expect(imapStats().open).toBe(1);
  });
});

describe("authentication", () => {
  it("reports a refused login and does not hammer the server", async () => {
    const bad = { ...cfg(), pass: "wrong" };
    await expect(op(bad)).rejects.toThrow(/Invalid credentials/);
    await expect(op(bad)).rejects.toThrow(/not retrying/);
    expect(srv.failedLogins).toBe(1);
    expect(srv.connections).toBe(1);
  });
  it("tries again after the pause", async () => {
    imapTimeouts.authBackoff = 30;
    const bad = { ...cfg(), pass: "wrong" };
    await expect(op(bad)).rejects.toThrow();
    await sleep(60);
    await expect(op(bad)).rejects.toThrow(/Invalid credentials/);
    expect(srv.failedLogins).toBe(2);
  });
  it("leaves no connection behind after a failed login", async () => {
    await expect(op({ ...cfg(), pass: "wrong" })).rejects.toThrow();
    await sleep(40);
    expect(srv.open).toBe(0);
    expect(imapStats().open).toBe(0);
  });
  it("rejects credentials that could break the protocol", async () => {
    await expect(op({ ...cfg(), user: "a\r\nb" })).rejects.toThrow(/bad credentials/);
  });
});

describe("account isolation", () => {
  it("never shares a connection between accounts", async () => {
    const other = await new FakeImapServer({ user: "other@example.com", pass: "other-pass" }).start();
    try {
      await op();
      await withImap({ host: "localhost", port: other.port, user: other.user, pass: other.pass, folder: "INBOX" }, ping, tlsOk);
      expect(srv.connections).toBe(1);
      expect(other.connections).toBe(1);
      await expect(withImap({ host: "localhost", port: other.port, user: srv.user, pass: srv.pass, folder: "INBOX" }, ping, tlsOk)).rejects.toThrow(/Invalid credentials/);
    } finally { closeAllImap(); await other.stop(); }
  });
  it("drops the old connections when the password changes", async () => {
    await op();
    expect(srv.open).toBe(1);
    const next = { ...srv, pass: "new-password" } as unknown as FakeImapServer;
    (srv as { pass: string }).pass = next.pass;
    await op({ ...cfg(), pass: "new-password" });
    await sleep(60);
    expect(srv.open).toBe(1);
    expect(imapStats().open).toBe(1);
    (srv as { pass: string }).pass = "app-password";
  });
  it("does not expose credentials or sockets to the operation", async () => {
    await withImap(cfg(), async (c) => {
      expect(Object.keys(c).sort()).toEqual(["account", "append", "capabilities", "cmd"]);
      expect(JSON.stringify(c)).not.toContain(srv.pass);
    }, tlsOk);
  });
});

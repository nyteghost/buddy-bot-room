// Mail benchmark against a SIMULATED IMAP server (src/test/helpers/fake-imap.ts): same script runs on any checkout.
//   bun scripts/bench-mail.mts            (env: MAIL_BENCH_RTT=40 ms, MAIL_BENCH_N=5000 messages in the inbox, MAIL_BENCH_RUNS=7)
// The simulator adds MAIL_BENCH_RTT to every reply and 2x to the connection greeting, so handshake cost is visible.
// It is not a real provider: use the numbers to compare versions, not as promises about Gmail.
import { FakeImapServer, makeMessages } from "../src/test/helpers/fake-imap.ts";
const client = (await import("../src/lib/imap-client.server.ts")) as { closeAllImap?: () => void; imapStats?: () => unknown }; // older checkouts have no pool
const closeAllImap = client.closeAllImap ?? (() => undefined);
const imapStats = client.imapStats ?? (() => null);
import { listMessages, readMessage, setMailTlsOverrides } from "../src/lib/mailbox.server.ts";

const rtt = Number(process.env["MAIL_BENCH_RTT"] ?? 40);
const N = Number(process.env["MAIL_BENCH_N"] ?? 5000);
const RUNS = Number(process.env["MAIL_BENCH_RUNS"] ?? 7);
const srv = await new FakeImapServer({ rttMs: rtt }).start();
srv.folders.get("INBOX")!.messages = makeMessages(N);
srv.folders.get("INBOX")!.uidnext = N + 1;
setMailTlsOverrides({ imap: { rejectUnauthorized: false } });
const cfg = { host: "localhost", port: srv.port, user: srv.user, pass: srv.pass, folder: "INBOX" };

type Row = { name: string; ms: number; connections: number; logins: number; commands: number; kb: number };
const median = (a: number[]) => [...a].sort((x, y) => x - y)[Math.floor(a.length / 2)]!;
const results: Row[] = [];

async function measure(name: string, fn: () => Promise<unknown>, warm = false): Promise<void> {
  const times: number[] = []; let last: Row | undefined;
  for (let i = 0; i < RUNS; i++) {
    if (!warm) closeAllImap(); // cold: nothing reusable carried over from the last run
    await new Promise((r) => setTimeout(r, 30));
    srv.resetCounters();
    const t0 = performance.now();
    await fn();
    const ms = performance.now() - t0;
    times.push(ms);
    last = { name, ms, connections: srv.connections, logins: srv.logins, commands: srv.commands.length, kb: Math.round(srv.bytesSent / 1024) };
  }
  results.push({ ...last!, ms: Math.round(median(times)) });
}

const mem0 = process.memoryUsage();
await measure("1 Inbox open (30 newest)", () => listMessages(cfg, { folder: "INBOX", limit: 30 }));
await measure("2 Open a message", () => readMessage(cfg, "INBOX", N - 3, false));
await measure("3 Switch folder (Sent)", () => listMessages(cfg, { folder: "[Gmail]/Sent Mail", limit: 30 }));
await measure("4 Search (subject text)", () => listMessages(cfg, { folder: "INBOX", q: `m subject ${N - 10}`, limit: 30 }));
// Warm: the connection from the step before is still open (what a user clicking around actually gets).
await listMessages(cfg, { folder: "INBOX", limit: 30 });
await measure("1w Inbox open, warm", () => listMessages(cfg, { folder: "INBOX", limit: 30 }), true);
await measure("2w Open a message, warm", () => readMessage(cfg, "INBOX", N - 3, false), true);
await measure("3w Switch folder, warm", () => listMessages(cfg, { folder: "[Gmail]/Sent Mail", limit: 30 }), true);
await measure("4w Search, warm", () => listMessages(cfg, { folder: "INBOX", q: `m subject ${N - 10}`, limit: 30 }), true);
// A realistic session: open inbox, read three messages, switch folder and back. Connections are NOT reset between steps.
closeAllImap(); await new Promise((r) => setTimeout(r, 30)); srv.resetCounters();
const s0 = performance.now();
await listMessages(cfg, { folder: "INBOX", limit: 30 });
for (const id of [N, N - 1, N - 2]) await readMessage(cfg, "INBOX", id, false);
await listMessages(cfg, { folder: "[Gmail]/Sent Mail", limit: 30 });
await listMessages(cfg, { folder: "INBOX", limit: 30 });
const session: Row = { name: "5 Session: inbox, 3 reads, Sent, inbox", ms: Math.round(performance.now() - s0), connections: srv.connections, logins: srv.logins, commands: srv.commands.length, kb: Math.round(srv.bytesSent / 1024) };
results.push(session);
const mem1 = process.memoryUsage();
const stats = (() => { try { return imapStats(); } catch { return null; } })();

console.log(`\nSimulated IMAP server, RTT ${rtt} ms, ${N} messages in the inbox, median of ${RUNS} cold runs (session row is one run)\n`);
console.log("| Operation | ms | TCP+TLS connections | LOGINs | IMAP commands | KB from server |\n|---|---:|---:|---:|---:|---:|");
for (const r of results) console.log(`| ${r.name} | ${r.ms} | ${r.connections} | ${r.logins} | ${r.commands} | ${r.kb} |`);
console.log(`\nheapUsed ${(mem0.heapUsed / 1048576).toFixed(1)} -> ${(mem1.heapUsed / 1048576).toFixed(1)} MB, rss ${(mem0.rss / 1048576).toFixed(0)} -> ${(mem1.rss / 1048576).toFixed(0)} MB`);
if (stats) console.log("pool stats:", JSON.stringify(stats));
closeAllImap();
await srv.stop();
process.exit(0);

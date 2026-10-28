import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { buildSearch, folderSignature, newestRange, parseSelectInfo } from "@/lib/mailbox";
import { createMailCache } from "@/lib/mail-cache";
import { closeAllImap } from "@/lib/imap-client.server";
import { clearMailboxCaches, deleteMessage, listMessages, mailCacheStats, moveMessage, readMessage, setMailTlsOverrides, setSeen } from "@/lib/mailbox.server";
import { FakeImapServer, makeMessages } from "./helpers/fake-imap";

describe("search keys", () => {
  it("plain words search the whole message like before", () => {
    expect(buildSearch("invoice")).toEqual({ criteria: 'TEXT "invoice"' });
    expect(buildSearch("")).toEqual({ criteria: "ALL" });
    expect(buildSearch("", true)).toEqual({ criteria: "UNSEEN" });
  });
  it("understands sender, subject, date and unread operators together", () => {
    expect(buildSearch('from:alice subject:"big sale" since:2026-10-01 before:2026-10-31 is:unread budget').criteria).toBe('FROM "alice" SUBJECT "big sale" SINCE 1-Oct-2026 BEFORE 31-Oct-2026 UNSEEN TEXT "budget"');
    expect(buildSearch("is:read to:bob").criteria).toBe('SEEN TO "bob"');
    expect(buildSearch("is:unread", true).criteria).toBe("UNSEEN");
  });
  it("escapes quotes so a search can't add commands", () => {
    expect(buildSearch('from:"a\\"b"').criteria).not.toMatch(/FROM "a"b"/);
    expect(buildSearch('x") DELETE ("y').criteria).not.toContain("\r");
  });
  it("explains bad dates and flags", () => {
    expect(buildSearch("since:tomorrow").error).toMatch(/dates like since:2026-10-31/);
    expect(buildSearch("since:2026-13-01").error).toBeTruthy();
    expect(buildSearch("is:starred").error).toMatch(/is:unread/);
  });
});

describe("folder numbers", () => {
  it("reads SELECT replies", () => {
    expect(parseSelectInfo("* 60 EXISTS\r\n* OK [UIDVALIDITY 1000] ok\r\n* OK [UIDNEXT 61] ok\r\nx OK done\r\n")).toEqual({ exists: 60, uidvalidity: "1000", uidnext: 61 });
    expect(parseSelectInfo("x OK\r\n")).toEqual({ exists: 0, uidvalidity: "", uidnext: 0 });
  });
  it("changes the signature when mail arrives or the folder was rebuilt", () => {
    const a = { exists: 5, uidvalidity: "1", uidnext: 6 };
    expect(folderSignature(a)).toBe("1|6|5");
    expect(folderSignature({ ...a, uidnext: 7, exists: 6 })).not.toBe(folderSignature(a));
    expect(folderSignature({ ...a, uidvalidity: "2" })).not.toBe(folderSignature(a));
  });
  it("pages by message number, newest first", () => {
    expect(newestRange(100, 30)).toEqual({ lo: 71, hi: 100 });
    expect(newestRange(100, 30, 30)).toEqual({ lo: 41, hi: 70 });
    expect(newestRange(100, 30, 90)).toEqual({ lo: 1, hi: 10 });
    expect(newestRange(10, 30)).toEqual({ lo: 1, hi: 10 });
    expect(newestRange(10, 30, 10)).toBeNull();
    expect(newestRange(0, 30)).toBeNull();
  });
});

describe("mail cache", () => {
  it("expires, evicts the oldest, and bounds total size", () => {
    const c = createMailCache<string>({ ttlMs: 100, max: 2, maxCost: 10, cost: (v) => v.length });
    c.set("a", "12345", 0); c.set("b", "12345", 0);
    expect(c.get("a", 50)).toBe("12345");
    c.set("c", "1", 60); // over the size limit: the least recently used (b) goes
    expect(c.get("b", 60)).toBeUndefined();
    expect(c.cost).toBeLessThanOrEqual(10);
    expect(c.get("a", 200)).toBeUndefined();
    c.set("big", "x".repeat(50), 0);
    expect(c.get("big", 0)).toBeUndefined();
  });
  it("can be switched off, and asked for a shorter age", () => {
    const off = createMailCache<number>({ ttlMs: 0, max: 5 });
    off.set("k", 1); expect(off.get("k")).toBeUndefined();
    const c = createMailCache<number>({ ttlMs: 1000, max: 5 });
    c.set("k", 1, 0);
    expect(c.get("k", 500, 100)).toBeUndefined();
    expect(c.get("k", 500)).toBe(1);
    c.deleteWhere((k) => k === "k"); expect(c.size).toBe(0);
  });
});

let srv: FakeImapServer;
const cfg = () => ({ host: "localhost", port: srv.port, user: srv.user, pass: srv.pass, folder: "INBOX" });
const inbox = () => srv.folders.get("INBOX")!;
beforeAll(async () => { srv = await new FakeImapServer().start(); setMailTlsOverrides({ imap: { rejectUnauthorized: false } }); });
afterAll(async () => { closeAllImap(); await srv.stop(); });
beforeEach(async () => {
  closeAllImap(); clearMailboxCaches();
  await new Promise((r) => setTimeout(r, 40)); // let closed sockets finish so connection counts start clean
  inbox().messages = makeMessages(60); inbox().uidnext = 61; inbox().uidvalidity = 1000;
  srv.folders.get("[Gmail]/Sent Mail")!.messages = makeMessages(15, 1, "sent");
  srv.folders.get("[Gmail]/Trash")!.messages = [];
  srv.resetCounters();
  delete process.env["MAIL_CACHE_SECONDS"];
});

describe("listing and paging", () => {
  it("returns the newest page without a mailbox-wide search", async () => {
    const r = await listMessages(cfg(), { limit: 30 });
    expect(r.total).toBe(60);
    expect(r.messages.map((m) => m.uid)).toEqual(Array.from({ length: 30 }, (_, i) => 60 - i));
    expect(srv.count("UID SEARCH")).toBe(0);
    expect(srv.commands.filter((c) => /FETCH/.test(c.cmd)).length).toBe(1);
  });
  it("pages back through older mail with no overlap or gap", async () => {
    const p1 = await listMessages(cfg(), { limit: 25, offset: 0 });
    const p2 = await listMessages(cfg(), { limit: 25, offset: 25 });
    const p3 = await listMessages(cfg(), { limit: 25, offset: 50 });
    const all = [...p1.messages, ...p2.messages, ...p3.messages].map((m) => m.uid);
    expect(all).toEqual(Array.from({ length: 60 }, (_, i) => 60 - i));
    expect((await listMessages(cfg(), { limit: 25, offset: 60 })).messages).toEqual([]);
  });
  it("keeps the page size within bounds", async () => {
    expect((await listMessages(cfg(), { limit: 500 })).messages.length).toBe(50);
    expect((await listMessages(cfg(), { limit: 0 })).messages.length).toBe(30);
  });
  it("handles an empty folder", async () => {
    const r = await listMessages(cfg(), { folder: "[Gmail]/Trash" });
    expect(r).toMatchObject({ total: 0, messages: [] });
  });
  it("rejects an unknown folder with a clear message", async () => {
    await expect(listMessages(cfg(), { folder: "Nope" })).rejects.toThrow(/doesn't exist/);
  });
});

describe("search runs on the server", () => {
  it("finds by subject, sender and unread without fetching everything", async () => {
    const bySubject = await listMessages(cfg(), { q: 'subject:"m subject 42"' });
    expect(bySubject.messages.map((m) => m.uid)).toEqual([42]);
    const bySender = await listMessages(cfg(), { q: "from:s3@example.com" });
    expect(bySender.messages.length).toBeGreaterThan(0);
    expect(bySender.messages.every((m) => m.fromAddr === "s3@example.com")).toBe(true);
    const unread = await listMessages(cfg(), { unread: true, limit: 50 });
    expect(unread.messages.every((m) => !m.seen)).toBe(true);
    expect(unread.total).toBe(20);
    expect(srv.count("UID SEARCH")).toBe(3);
  });
  it("pages through search results", async () => {
    const a = await listMessages(cfg(), { unread: true, limit: 8, offset: 0 });
    const b = await listMessages(cfg(), { unread: true, limit: 8, offset: 8 });
    expect(a.messages.length).toBe(8);
    expect(a.messages.map((m) => m.uid).concat(b.messages.map((m) => m.uid))).toEqual([...new Set([...a.messages, ...b.messages].map((m) => m.uid))]);
    expect(Math.min(...a.messages.map((m) => m.uid))).toBeGreaterThan(Math.max(...b.messages.map((m) => m.uid)));
  });
  it("reports bad search words before touching the server", async () => {
    await expect(listMessages(cfg(), { q: "since:soon" })).rejects.toThrow(/dates like/);
    expect(srv.connections).toBe(0);
  });
});

describe("caching and invalidation", () => {
  it("answers an unchanged folder from memory but still checks it first", async () => {
    await listMessages(cfg());
    srv.resetCounters();
    const again = await listMessages(cfg());
    expect(again.cached).toBe(true);
    expect(srv.commands.filter((c) => /FETCH|SEARCH/.test(c.cmd)).length).toBe(0);
    expect(srv.count("SELECT")).toBe(1); // the freshness check
  });
  it("shows new mail straight away because the folder numbers changed", async () => {
    await listMessages(cfg());
    inbox().messages.push(...makeMessages(1, 61)); inbox().uidnext = 62;
    const r = await listMessages(cfg());
    expect(r.cached).toBeUndefined();
    expect(r.messages[0]?.uid).toBe(61);
    expect(r.total).toBe(61);
  });
  it("refetches on request and when the cache is off", async () => {
    await listMessages(cfg());
    expect((await listMessages(cfg(), { fresh: true })).cached).toBeUndefined();
    process.env["MAIL_CACHE_SECONDS"] = "0";
    expect((await listMessages(cfg())).cached).toBeUndefined();
  });
  it("keeps accounts' caches apart", async () => {
    await listMessages(cfg());
    clearMailboxCaches("someone-else@example.com@localhost");
    expect(mailCacheStats().lists).toBeGreaterThan(0);
    clearMailboxCaches(`${srv.user}@localhost`);
    expect(mailCacheStats().lists).toBe(0);
  });
  it("asks for the folder list once and not on every switch", async () => {
    await listMessages(cfg());
    await listMessages(cfg(), { folder: "[Gmail]/Sent Mail" });
    await listMessages(cfg());
    expect(srv.count("LIST")).toBe(1);
  });
  it("notices a folder that appeared after the list was cached", async () => {
    await listMessages(cfg());
    srv.addFolder("Receipts", makeMessages(3, 1, "rc"));
    const r = await listMessages(cfg(), { folder: "Receipts" });
    expect(r.messages.length).toBe(3);
    expect(srv.count("LIST")).toBe(2);
  });
  it("ignores everything cached when the folder's UIDVALIDITY changes", async () => {
    const first = await readMessage(cfg(), "INBOX", 60, false);
    expect(first.text).toContain("Hello 60");
    inbox().uidvalidity = 2000;
    inbox().messages = inbox().messages.map((m) => (m.uid === 60 ? { ...m, body: "Brand new content.\r\n" } : m));
    const second = await readMessage(cfg(), "INBOX", 60, false);
    expect(second.text).toContain("Brand new content");
    const list = await listMessages(cfg());
    expect(list.cached).toBeUndefined();
  });
});

describe("opening messages", () => {
  it("does not download the body twice", async () => {
    const a = await readMessage(cfg(), "INBOX", 59, false);
    const b = await readMessage(cfg(), "INBOX", 59, false);
    expect(b).toEqual(a);
    expect(srv.commands.filter((c) => /BODY\.PEEK\[\]/.test(c.cmd)).length).toBe(1);
  });
  it("marks unread mail as read once", async () => {
    const m = await readMessage(cfg(), "INBOX", 60, true); // uid 60 is unread in the fixture
    expect(m.seen).toBe(true);
    await readMessage(cfg(), "INBOX", 60, true);
    expect(srv.count("UID STORE")).toBe(1);
    expect(inbox().messages.find((x) => x.uid === 60)!.flags).toContain("\\Seen");
  });
  it("keeps mail unread when asked to", async () => {
    const m = await readMessage(cfg(), "INBOX", 60, false);
    expect(m.seen).toBe(false);
    expect(srv.count("UID STORE")).toBe(0);
  });
  it("shows the read mark in the list after reading", async () => {
    const before = await listMessages(cfg(), { limit: 5 });
    expect(before.messages.find((m) => m.uid === 60)?.seen).toBe(false);
    await readMessage(cfg(), "INBOX", 60, true);
    const after = await listMessages(cfg(), { limit: 5 });
    expect(after.messages.find((m) => m.uid === 60)?.seen).toBe(true);
  });
  it("says so when the message is gone", async () => {
    await expect(readMessage(cfg(), "INBOX", 9999, false)).rejects.toThrow(/gone/);
    await expect(readMessage(cfg(), "INBOX", "abc", false)).rejects.toThrow(/Bad message number/);
  });
});

describe("changing mail", () => {
  it("mark unread updates the list at once", async () => {
    await listMessages(cfg());
    await setSeen(cfg(), "INBOX", 59, false);
    const r = await listMessages(cfg(), { limit: 5 });
    expect(r.messages.find((m) => m.uid === 59)?.seen).toBe(false);
  });
  it("moving a message removes it from the old folder and adds it to the new one", async () => {
    await listMessages(cfg()); await listMessages(cfg(), { folder: "[Gmail]/Sent Mail" });
    const r = await moveMessage(cfg(), "INBOX", 58, "[Gmail]/Sent Mail");
    expect(r.moved).toBeTruthy();
    expect((await listMessages(cfg(), { limit: 50 })).messages.some((m) => m.uid === 58)).toBe(false);
    expect((await listMessages(cfg(), { folder: "[Gmail]/Sent Mail", limit: 50 })).total).toBe(16);
    expect(srv.count("UID MOVE") + srv.count("UID COPY")).toBe(1);
  });
  it("delete goes to Trash, and deleting from Trash is for good", async () => {
    const d = await deleteMessage(cfg(), "INBOX", 57);
    expect(d.forever).toBe(false);
    expect((await listMessages(cfg(), { folder: "[Gmail]/Trash" })).total).toBe(1);
    expect((await listMessages(cfg(), { limit: 50 })).messages.some((m) => m.uid === 57)).toBe(false);
    const trashUid = srv.folders.get("[Gmail]/Trash")!.messages[0]!.uid;
    expect((await deleteMessage(cfg(), "[Gmail]/Trash", trashUid)).forever).toBe(true);
    expect((await listMessages(cfg(), { folder: "[Gmail]/Trash" })).total).toBe(0);
  });
  it("never runs a delete or move twice", async () => {
    await deleteMessage(cfg(), "INBOX", 56);
    expect(srv.count("UID MOVE") + srv.count("UID STORE") + srv.count("UID COPY")).toBeLessThanOrEqual(2);
    expect(srv.count("UID MOVE")).toBe(1);
  });
});

describe("rapid folder switching", () => {
  it("gives every request its own folder's mail", async () => {
    srv.rttMs = 4;
    const names = ["INBOX", "[Gmail]/Sent Mail", "INBOX", "[Gmail]/Sent Mail", "[Gmail]/Trash", "INBOX"];
    const results = await Promise.all(names.map((n) => listMessages(cfg(), { folder: n })));
    results.forEach((r, i) => { expect(r.folder).toBe(names[i]); expect(r.total).toBe(names[i] === "INBOX" ? 60 : names[i] === "[Gmail]/Trash" ? 0 : 15); });
    srv.rttMs = 0;
    expect(srv.maxOpen).toBeLessThanOrEqual(2);
  });
});

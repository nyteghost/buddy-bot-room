import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { attachmentBytes, attachmentKind, attachmentList, buildMessage, parseMessage } from "@/lib/mailbox";
import { closeAllImap } from "@/lib/imap-client.server";
import { attachmentResponse, clearMailboxCaches, listMessages, readAttachment, readMessage, setMailTlsOverrides } from "@/lib/mailbox.server";
import { FakeImapServer, makeMessages } from "./helpers/fake-imap";

const b64 = (s: string | Uint8Array) => Buffer.from(s).toString("base64");
const PDF = "%PDF-1.4\n1 0 obj<<>>endobj\ntrailer<<>>\n%%EOF";
const XLSX = new Uint8Array([0x50, 0x4b, 3, 4, 0, 255, 128, 7, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10]);
const msg = (extra: { name: string; type: string; data: string }[] = [{ name: "Crew list.pdf", type: "application/pdf", data: b64(PDF) }, { name: "budget.xlsx", type: "application/octet-stream", data: b64(XLSX) }]) =>
  buildMessage({ from: "a@b.co", to: ["me@example.com"], subject: "Files", text: "See attached.", messageId: "<f@x>", attachments: extra });

describe("attachment list", () => {
  it("lists names, kinds, sizes and keeps the order", () => {
    const list = attachmentList(msg());
    expect(list.map((f) => [f.index, f.name, f.kind])).toEqual([[0, "Crew list.pdf", "pdf"], [1, "budget.xlsx", "sheet"]]);
    expect(list[0]?.size).toBe(PDF.length);
    expect(list[1]?.size).toBe(XLSX.length);
  });
  it("doesn't pretend to know sizes when only the start of a message was downloaded", () => {
    expect(attachmentList(msg(), false).every((f) => f.size === -1)).toBe(true);
  });
  it("decides the viewer from the extension first, then the type", () => {
    expect(attachmentKind("A.PDF")).toBe("pdf");
    expect(attachmentKind("x", "application/pdf")).toBe("pdf");
    for (const n of ["a.xlsx", "a.XLSM", "a.xls", "a.csv"]) expect(attachmentKind(n, "application/octet-stream")).toBe("sheet");
    expect(attachmentKind("a.docx")).toBe("other");
    expect(attachmentKind("report.pdf.exe")).toBe("other");
  });
  it("returns exact bytes, including binary", () => {
    expect(new TextDecoder().decode(attachmentBytes(msg(), 0)!.bytes)).toBe(PDF);
    expect([...attachmentBytes(msg(), 1)!.bytes]).toEqual([...XLSX]);
    expect(attachmentBytes(msg(), 2)).toBeNull();
  });
  it("is part of the parsed message and leaves the plain-text body alone", () => {
    const m = parseMessage(1, [], msg());
    expect(m.text).toContain("See attached.");
    expect(m.attachments).toEqual(["Crew list.pdf", "budget.xlsx"]);
    expect(m.files).toHaveLength(2);
  });
  it("copes with messages without attachments", () => {
    expect(attachmentList("Subject: x\r\n\r\nhello")).toEqual([]);
  });
});

let srv: FakeImapServer;
const cfg = () => ({ host: "localhost", port: srv.port, user: srv.user, pass: srv.pass, folder: "INBOX" });
const inbox = () => srv.folders.get("INBOX")!;
const bodyFetches = () => srv.commands.filter((c) => /BODY\.PEEK\[\](?!<)/.test(c.cmd)).length;
beforeAll(async () => { srv = await new FakeImapServer().start(); setMailTlsOverrides({ imap: { rejectUnauthorized: false } }); });
afterAll(async () => { closeAllImap(); await srv.stop(); });
beforeEach(async () => {
  closeAllImap(); clearMailboxCaches();
  await new Promise((r) => setTimeout(r, 40));
  inbox().messages = makeMessages(5);
  inbox().messages[4] = { ...inbox().messages[4]!, uid: 5, flags: [], raw: msg() };
  inbox().uidnext = 6;
  srv.resetCounters();
  delete process.env["MAIL_ATTACHMENT_MAX_MB"];
});

describe("opening attachments", () => {
  it("lists attachments when the message is opened but downloads none", async () => {
    const m = await readMessage(cfg(), "INBOX", 5, false);
    expect(m.files.map((f) => f.name)).toEqual(["Crew list.pdf", "budget.xlsx"]);
    expect(srv.commands.some((c) => /RFC822\.SIZE/.test(c.cmd))).toBe(false);
  });
  it("fetches the file only when asked, without marking the message read", async () => {
    const a = await readAttachment(cfg(), "INBOX", 5, 0);
    expect(new TextDecoder().decode(a.bytes)).toBe(PDF);
    expect(srv.folders.get("INBOX")!.messages.find((x) => x.uid === 5)!.flags).not.toContain("\\Seen");
    expect(srv.count("UID STORE")).toBe(0);
  });
  it("serves a second request from memory", async () => {
    await readAttachment(cfg(), "INBOX", 5, 1);
    const before = bodyFetches();
    const again = await readAttachment(cfg(), "INBOX", 5, 1);
    expect([...again.bytes]).toEqual([...XLSX]);
    expect(bodyFetches()).toBe(before);
  });
  it("refuses a file that is too large before downloading the message", async () => {
    process.env["MAIL_ATTACHMENT_MAX_MB"] = "1";
    inbox().messages[4]!.raw = msg([{ name: "big.pdf", type: "application/pdf", data: b64(new Uint8Array(2_000_000)) }]);
    await expect(readAttachment(cfg(), "INBOX", 5, 0)).rejects.toThrow(/too large/);
    expect(bodyFetches()).toBe(0);
  });
  it("rejects bad numbers and missing attachments with plain messages", async () => {
    await expect(readAttachment(cfg(), "INBOX", 5, 7)).rejects.toThrow(/isn't in the message/);
    await expect(readAttachment(cfg(), "INBOX", 5, "x")).rejects.toThrow(/Bad attachment/);
    await expect(readAttachment(cfg(), "INBOX", 5, -1)).rejects.toThrow(/Bad attachment/);
    await expect(readAttachment(cfg(), "INBOX", "abc", 0)).rejects.toThrow(/Bad message/);
    await expect(readAttachment(cfg(), "INBOX", 999, 0)).rejects.toThrow(/gone/);
  });
  it("is not served from memory after the folder is rebuilt", async () => {
    await readAttachment(cfg(), "INBOX", 5, 0);
    inbox().uidvalidity = 7777;
    inbox().messages[4]!.raw = msg([{ name: "new.pdf", type: "application/pdf", data: b64("%PDF-new") }]);
    expect(new TextDecoder().decode((await readAttachment(cfg(), "INBOX", 5, 0)).bytes)).toBe("%PDF-new");
  });
  it("is forgotten for the account when its cache is cleared", async () => {
    await readAttachment(cfg(), "INBOX", 5, 0);
    clearMailboxCaches(`${srv.user}@localhost`);
    const before = bodyFetches();
    await readAttachment(cfg(), "INBOX", 5, 0);
    expect(bodyFetches()).toBe(before + 1);
  });
  it("doesn't disturb listing", async () => {
    expect((await listMessages(cfg(), { limit: 10 })).messages).toHaveLength(5);
  });
});

describe("download response", () => {
  const pdf = { name: "Crew list.pdf", type: "application/pdf", bytes: new TextEncoder().encode(PDF) };
  it("is private, can't be sniffed and can't run anything", () => {
    const r = attachmentResponse(pdf, false);
    expect(r.headers.get("content-type")).toBe("application/pdf");
    expect(r.headers.get("cache-control")).toBe("private, no-store");
    expect(r.headers.get("x-content-type-options")).toBe("nosniff");
    expect(r.headers.get("content-security-policy")).toContain("sandbox");
    expect(r.headers.get("content-disposition")).toMatch(/^inline;/);
    expect(r.headers.get("content-length")).toBe(String(PDF.length));
  });
  it("forces a download for other files and when asked", () => {
    expect(attachmentResponse(pdf, true).headers.get("content-disposition")).toMatch(/^attachment;/);
    const html = attachmentResponse({ name: "x.html", type: "text/html", bytes: new TextEncoder().encode("<script>alert(1)</script>") }, false);
    expect(html.headers.get("content-type")).toBe("application/octet-stream");
    expect(html.headers.get("content-disposition")).toMatch(/^attachment;/);
  });
  it("can't be tricked by file names", () => {
    const r = attachmentResponse({ ...pdf, name: 'a"\r\nSet-Cookie: x=1.pdf' }, false);
    const d = r.headers.get("content-disposition") ?? "";
    expect(d).not.toMatch(/[\r\n]/);
    expect(d.match(/"/g)?.length).toBe(2);
  });
  it("gives spreadsheets their proper types", () => {
    expect(attachmentResponse({ name: "a.xlsx", type: "", bytes: new Uint8Array(1) }, false).headers.get("content-type")).toContain("spreadsheetml");
    expect(attachmentResponse({ name: "a.csv", type: "", bytes: new Uint8Array(1) }, false).headers.get("content-type")).toContain("text/csv");
  });
});

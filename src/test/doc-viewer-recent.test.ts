import { describe, expect, it } from "vitest";
import { addRecent, parseRecent, removeRecent, type RecentDoc } from "@/lib/doc-viewer/recent";
import { humanSize, mailAttachmentUrl, sourceKey, sourceKind } from "@/lib/doc-viewer/doc-source";

const local = (n: number): RecentDoc => ({ id: `l${n}`, kind: "pdf", name: `f${n}.pdf`, size: n, at: n, origin: "local" });

describe("recent documents", () => {
  it("puts the newest first, removes duplicates and caps the list", () => {
    let l: RecentDoc[] = [];
    for (let i = 0; i < 20; i++) l = addRecent(l, local(i));
    expect(l).toHaveLength(12); expect(l[0]!.id).toBe("l19");
    l = addRecent(l, local(15));
    expect(l.filter((d) => d.id === "l15")).toHaveLength(1); expect(l[0]!.id).toBe("l15");
    expect(removeRecent(l, "l15").some((d) => d.id === "l15")).toBe(false);
  });
  it("survives a round trip and ignores junk", () => {
    const mail: RecentDoc = { id: "m1", kind: "sheet", name: "a.xlsx", size: 10, at: 5, origin: "mail", folder: "INBOX", uid: 3, index: 1 };
    expect(parseRecent(JSON.stringify([mail, local(1)]))).toEqual([mail, local(1)]);
    expect(parseRecent("not json")).toEqual([]);
    expect(parseRecent(JSON.stringify({ a: 1 }))).toEqual([]);
    expect(parseRecent(JSON.stringify([null, 4, { id: "", name: "x" }, { id: "a", name: "b", origin: "mail", folder: 5, uid: "x", index: 0 }, { id: "z", name: "z", origin: "weird" }]))).toEqual([]);
    expect(parseRecent(null)).toEqual([]);
  });
});

describe("document sources", () => {
  const mail = { kind: "mail" as const, folder: "[Gmail]/Sent Mail", uid: 12, index: 1, name: "Crew.PDF" };
  it("builds the authenticated attachment address", () => {
    expect(mailAttachmentUrl(mail)).toBe("/api/mailbox?op=attachment&folder=%5BGmail%5D%2FSent%20Mail&uid=12&index=1");
    expect(mailAttachmentUrl(mail, true)).toMatch(/&download=1$/);
  });
  it("picks the viewer by name", () => {
    expect(sourceKind(mail)).toBe("pdf");
    expect(sourceKind({ ...mail, name: "a.xlsm" })).toBe("sheet");
    expect(sourceKind({ ...mail, name: "a.zip" })).toBe("other");
    expect(sourceKey(mail)).toBe("mail:[Gmail]/Sent Mail:12:1");
  });
  it("shows sizes in plain units", () => {
    expect(humanSize(-1)).toBe(""); expect(humanSize(512)).toBe("512 B"); expect(humanSize(2048)).toBe("2 KB"); expect(humanSize(5_242_880)).toBe("5.0 MB");
  });
});

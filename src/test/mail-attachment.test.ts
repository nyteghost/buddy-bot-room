import { describe, expect, it } from "vitest";
import { buildMessage } from "@/lib/mailbox";

describe("buildMessage attachments", () => {
  const base = { from: "a@b.co", to: ["c@d.co"], subject: "Crew", text: "hi", messageId: "<x@y>" };
  it("stays plain text without attachments", () => {
    expect(buildMessage(base)).toContain("Content-Type: text/plain");
  });
  it("wraps text and a file in multipart/mixed", () => {
    const m = buildMessage({ ...base, attachments: [{ name: "crew parts.xlsx", type: "application/octet-stream", data: "AAAA" }] });
    expect(m).toContain("multipart/mixed");
    expect(m).toContain('filename="crew parts.xlsx"');
    expect(m.match(/--pp_\w+--/)).toBeTruthy();
  });
});

import { gmailLink, isGmailHost } from "@/lib/mailbox";
describe("open in Gmail link", () => {
  it("searches Gmail for the message by its Message-ID", () => {
    expect(gmailLink("me@gmail.com", "<abc.123@mail.example>")).toBe("https://mail.google.com/mail/?authuser=me%40gmail.com#search/rfc822msgid%3Aabc.123%40mail.example");
    expect(gmailLink("me@gmail.com", "")).toBeNull();
    expect(gmailLink("not an address", "<a@b>")).toBeNull();
  });
  it("only for Gmail servers", () => {
    expect(isGmailHost("imap.gmail.com")).toBe(true);
    expect(isGmailHost("imap.fastmail.com")).toBe(false);
  });
});

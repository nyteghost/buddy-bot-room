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

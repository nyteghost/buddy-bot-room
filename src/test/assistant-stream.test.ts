import { expect, it } from "vitest";
import { answerPreview, responseLines } from "@/lib/assistant-stream";
it("decodes split UTF-8 characters, CRLF and a final line without a newline", async () => {
  const bytes = new TextEncoder().encode("data: café\r\n\ndata: final");
  const response = new Response(
    new ReadableStream({
      start(c) {
        for (const byte of bytes) c.enqueue(new Uint8Array([byte]));
        c.close();
      },
    }),
  );
  const lines = [];
  for await (const line of responseLines(response)) lines.push(line);
  expect(lines).toEqual(["data: café", "", "data: final"]);
});
it("releases ordinary text before completion but holds incomplete words", () => {
  expect(answerPreview("Here is a useful answ")).toBe("Here is a useful ");
});
it("holds credential-like lines, split tokens, URLs and multi-line keys until final scrubbing", () => {
  for (const risky of [
    'password="uniquesecretvalue\ncontinued secret"',
    'MY_PASSWORD="uniquesecretvalue with spaces"',
    'DB_USER="uniquesecretvalue with spaces"',
    "The password is uniquesecretvalue",
    "Bearer uniquesecretvalue",
    "https://user:uniquesecretvalue@example.test/",
    "-----BEGIN RSA PRIVATE KEY-----\nuniquesecretvalue\n-----END RSA PRIVATE KEY-----",
    "sk-uniquesecretvalue1234567890 ",
    "login=uniquesecretvalue",
  ]) {
    const raw = "A useful introduction.\n" + risky;
    for (let end = 0; end <= raw.length; end++)
      expect(answerPreview(raw.slice(0, end))).not.toContain("uniquesecret");
  }
  expect(
    answerPreview("Contact someone@example.test for help ", { maskIdentifiers: true }),
  ).not.toContain("someone@");
});
it("cancels an upstream reader when the consumer stops", async () => {
  let cancelled = false;
  const response = new Response(
    new ReadableStream({
      start(c) {
        c.enqueue(new TextEncoder().encode("first\n"));
      },
      cancel() {
        cancelled = true;
      },
    }),
  );
  for await (const line of responseLines(response)) {
    expect(line).toBe("first");
    break;
  }
  expect(cancelled).toBe(true);
});

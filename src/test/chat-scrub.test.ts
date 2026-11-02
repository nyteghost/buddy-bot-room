import { expect, it } from "vitest";
import { scrubChatText, scrubChatData, scrubBrowserChatHistory } from "@/lib/chat-scrub";
it("scrubs labelled passwords, login identities and tokens while preserving surrounding configuration labels", () => {
  const raw =
    'OLLAMA_URL=http://pc:11434\nBUDDY_PASSWORD="secret with spaces"\nusername: testlogin\nAPI_KEY=abcdefghijklmnop\nrefresh_token=another-secret';
  const out = scrubChatText(raw);
  for (const value of ["secret with spaces", "testlogin", "abcdefghijklmnop", "another-secret"])
    expect(out).not.toContain(value);
  expect(out).toContain("OLLAMA_URL=http://pc:11434");
  expect(out).toContain("BUDDY_PASSWORD=");
});
it("removes recognized token formats, authorization headers, cookies and multiline private keys", () => {
  const raw =
    "Bearer abcdefghijklmnop\nCookie: session=secretcookie; other=value\n-----BEGIN RSA PRIVATE KEY-----\nPRIVATEFAKEDATA\n-----END RSA PRIVATE KEY-----\nghp_abcdefghijklmnop1234567890";
  const out = scrubChatText(raw);
  for (const value of ["abcdefghijklmnop", "secretcookie", "PRIVATEFAKEDATA"])
    expect(out).not.toContain(value);
  expect(out).toContain("[hidden");
});
it("scrubs credentials embedded in URLs, query strings and CLI login arguments", () => {
  for (const raw of [
    "https://testlogin:secretpass@example.com/a?access_token=secretvalue",
    "postgres://testlogin:secretpass@localhost/db",
    "docker login --username testlogin --password secretpass",
    "curl -u testlogin:secretpass https://example.com",
    "sshpass -p secretpass ssh host",
  ]) {
    const out = scrubChatText(raw);
    expect(out).not.toContain("secretpass");
    expect(out).not.toContain("secretvalue");
    expect(out).not.toContain("testlogin");
  }
});
it("preserves valid quoted JSON, message identifiers, roles and useful non-secret text", () => {
  expect(JSON.parse(scrubChatText('{"password":"secretpass","port":11434}'))).toEqual({
    password: "[hidden]",
    port: 11434,
  });
  const data = {
    id: "message001",
    role: "user",
    parts: [{ type: "text", text: "Restart Ollama\npassword=secretpass" }],
  };
  const out = scrubChatData(data);
  expect(out.id).toBe(data.id);
  expect(out.role).toBe("user");
  expect(out.parts[0]!.text).toContain("Restart Ollama");
  expect(data.parts[0]!.text).toContain("secretpass");
});
it("is idempotent so history, model and storage layers cannot damage already-hidden placeholders", () => {
  for (const raw of [
    "password=secretpass",
    "my password is secret with spaces",
    '{"token":"abc123"}',
    "Cookie: session=abcd",
    "https://testlogin:secretpass@example.com?token=abc123",
    "--password secretpass",
  ]) {
    const once = scrubChatText(raw);
    expect(scrubChatText(once)).toBe(once);
  }
});
it("only masks standalone email addresses when selected; ordinary password questions and provider configs are not passed to this helper", () => {
  expect(scrubChatText("How do I reset a password? Contact me@example.com")).toBe(
    "How do I reset a password? Contact me@example.com",
  );
  expect(scrubChatText("Contact me@example.com", { maskIdentifiers: true })).toContain(
    "[hidden email]",
  );
});

it("cleans only known browser chat stores, leaving actual provider settings intact", () => {
  localStorage.clear();
  localStorage.setItem("pixel-pals-assistant-draft-test", "password=secretpass");
  localStorage.setItem(
    "pixel-pals-focus-food-v1",
    JSON.stringify({ chatHistory: [{ answer: "token=secretvalue" }], recipes: [{ name: "Test" }] }),
  );
  localStorage.setItem(
    "pixel-pals-engine-v1",
    JSON.stringify({ apiKey: "intentional-provider-key" }),
  );
  expect(scrubBrowserChatHistory(localStorage)).toBe(2);
  expect(localStorage.getItem("pixel-pals-assistant-draft-test")).not.toContain("secretpass");
  expect(localStorage.getItem("pixel-pals-focus-food-v1")).not.toContain("secretvalue");
  expect(localStorage.getItem("pixel-pals-engine-v1")).toContain("intentional-provider-key");
  expect(scrubBrowserChatHistory(localStorage)).toBe(0);
  localStorage.clear();
});

it("scrubs common user/pass labels and text appended while typing into an already scrubbed field", () => {
  expect(scrubChatText("user=testlogin pass=secretpass")).not.toMatch(/testlogin|secretpass/);
  expect(scrubChatText("password=[hidden]secretSuffix")).toBe("password=[hidden]");
  expect(scrubChatText("Bearer [hidden]secretSuffix")).toBe("Bearer [hidden]");
});

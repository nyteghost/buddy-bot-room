import { describe, expect, it } from "vitest";
import { gate, loginLimiter } from "@/lib/gate.server";
import { createLimiter } from "@/lib/rate-limit";
import { applySecurityHeaders } from "@/lib/security-headers";
import { readSession, signSession } from "@/lib/accounts";

const req = (path: string, init?: RequestInit & { cookie?: string }) => new Request(`http://box:8090${path}`, { ...init, headers: { ...(init?.cookie ? { cookie: init.cookie } : {}), ...(init?.headers as Record<string, string> | undefined) } });
const login = (pw: string, ip = "1.1.1.1", password = "pw", now?: number) => gate(req("/__login", { method: "POST", headers: { "x-forwarded-for": ip }, body: new URLSearchParams({ password: pw }) }), password, now);

describe("sign-in rate limit", () => {
  it("limits one address, and also the whole server so a faked address header does not help", () => {
    const l = createLimiter({ max: 3, windowMs: 1000, globalMax: 5 });
    for (let i = 0; i < 3; i++) l.fail("a", 0);
    expect(l.blocked("a", 0)).toBe(true);
    expect(l.blocked("b", 0)).toBe(false);
    l.fail("b", 0); l.fail("c", 0);
    expect(l.blocked("d", 0)).toBe(true); // 5 failures overall
    expect(l.blocked("d", 1500)).toBe(false); // window over
    l.fail("a", 2000);
    l.clear("a");
    expect(l.blocked("a", 2000)).toBe(false);
  });
  it("bounds how many addresses it remembers", () => {
    const l = createLimiter({ max: 3, windowMs: 1000, globalMax: 1e9, maxKeys: 10 });
    for (let i = 0; i < 100; i++) l.fail(`ip${i}`, 0);
    expect(l.blocked("ip0", 0)).toBe(false); // forgotten, not remembered forever
  });
  it("the password gate locks out a server-wide guessing run that rotates fake addresses", async () => {
    loginLimiter.reset();
    let last = "";
    for (let i = 0; i < 41; i++) last = (await (await login(`wrong${i}`, `10.0.0.${i}`))?.text()) ?? "";
    expect(last).toContain("Too many");
    expect(await (await login("pw", "10.9.9.9"))?.text()).toContain("Too many"); // even the right password waits
    loginLimiter.reset();
    expect((await login("pw", "10.9.9.9"))?.status).toBe(303);
  });
});

describe("gate sessions", () => {
  it("issue a signed, expiring token, never the password or a hash of it", async () => {
    loginLimiter.reset();
    const res = await login("hunter2hunter2", "2.2.2.2", "hunter2hunter2");
    const cookie = (res?.headers.get("set-cookie") ?? "").split(";")[0]!;
    const token = cookie.replace("buddy_auth=", "");
    expect(token.split(".")).toHaveLength(2);
    expect(token).not.toMatch(/^[0-9a-f]{64}$/); // the old cookie was a bare SHA-256 of the password
    expect(await gate(req("/", { cookie }), "hunter2hunter2")).toBeNull();
  });
  it("stop working after 30 days, when forged, and when the password changes", async () => {
    loginLimiter.reset();
    const now = Date.UTC(2026, 9, 28);
    const cookie = ((await login("pw", "3.3.3.3", "pw", now))?.headers.get("set-cookie") ?? "").split(";")[0]!;
    expect(await gate(req("/", { cookie }), "pw", now + 29 * 86_400_000)).toBeNull();
    expect((await gate(req("/", { cookie }), "pw", now + 31 * 86_400_000))?.status).toBe(401);
    expect((await gate(req("/", { cookie }), "a-new-password", now))?.status).toBe(401);
    const forged = `buddy_auth=${await signSession("gate", "not-the-secret", now)}`;
    expect((await gate(req("/", { cookie: forged }), "pw", now))?.status).toBe(401);
    expect((await gate(req("/", { cookie: "buddy_auth=" + "0".repeat(64) }), "pw", now))?.status).toBe(401);
  });
  it("tokens signed for a person account are not accepted as a gate session", async () => {
    expect(await readSession(await signSession("alice", "k"), "k")).toBe("alice");
  });
});

describe("security headers", () => {
  it("adds the defaults to a plain response", () => {
    const r = applySecurityHeaders(new Response("hi"));
    expect(r.headers.get("x-content-type-options")).toBe("nosniff");
    expect(r.headers.get("referrer-policy")).toBe("same-origin");
    expect(r.headers.get("x-frame-options")).toBe("SAMEORIGIN");
    expect(r.headers.get("content-security-policy")).toBe("frame-ancestors 'self'");
  });
  it("keeps a policy the response already has (sandboxed attachments, add-on pages)", () => {
    const r = applySecurityHeaders(new Response("x", { headers: { "content-security-policy": "sandbox; default-src 'none'", "x-content-type-options": "nosniff" } }));
    expect(r.headers.get("content-security-policy")).toBe("sandbox; default-src 'none'");
  });
  it("works on a response whose headers cannot be changed, and keeps status, body and cookies", async () => {
    const original = Response.redirect("http://box/x", 303);
    const r = applySecurityHeaders(original);
    expect(r.status).toBe(303);
    expect(r.headers.get("x-frame-options")).toBe("SAMEORIGIN");
    const cookie = applySecurityHeaders(new Response("body", { headers: { "set-cookie": "a=1; Path=/" } }));
    expect(cookie.headers.get("set-cookie")).toBe("a=1; Path=/");
    expect(await cookie.text()).toBe("body");
  });
  it("can leave out the anti-framing headers for people who embed the app on purpose", () => {
    const r = applySecurityHeaders(new Response("hi"), { allowFraming: true });
    expect(r.headers.get("x-frame-options")).toBeNull();
    expect(r.headers.get("content-security-policy")).toBeNull();
    expect(r.headers.get("x-content-type-options")).toBe("nosniff");
  });
});

import { readFileSync } from "node:fs";
describe("Docker defaults", () => {
  it("publish the stack's Ollama (no password) on the server's own address unless told otherwise", () => {
    for (const f of ["docker-compose.unraid.yml", "docker-compose.portainer.yml"]) {
      const text = readFileSync(f, "utf8");
      expect(text).toMatch(/\$\{OLLAMA_BIND:-127\.0\.0\.1\}:\$\{OLLAMA_PORT:-\d+\}:11434/);
      expect(text).not.toMatch(/docker\.sock/);
      expect(text).not.toMatch(/privileged:\s*true/);
    }
  });
});

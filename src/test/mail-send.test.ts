import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { sendMail, setMailTlsOverrides } from "@/lib/mailbox.server";
import type { SmtpConfig } from "@/lib/smtp.server";
import { FakeSmtpServer } from "./helpers/fake-smtp";

let srv: FakeSmtpServer;
const cfg = (): SmtpConfig => ({ host: "localhost", port: srv.port, user: srv.user, pass: srv.pass, from: srv.user, name: "Me", implicitTls: true });
const mail = { to: "you@example.com", subject: "Hi", text: "Hello there" };

beforeAll(async () => { srv = await new FakeSmtpServer().start(); setMailTlsOverrides({ smtp: { rejectUnauthorized: false } }); });
afterAll(async () => { await srv.stop(); });
beforeEach(() => srv.reset());

describe("sending", () => {
  it("sends once on one connection", async () => {
    const r = await sendMail(cfg(), mail, 1_000_000);
    expect(r.to).toEqual(["you@example.com"]);
    expect(srv.connections).toBe(1);
    expect(srv.dataAttempts).toBe(1);
    expect(srv.delivered).toHaveLength(1);
  });
  it("never retries when the connection drops after the message was handed over (it may have been delivered)", async () => {
    srv.mode = "drop-after-data";
    await expect(sendMail(cfg(), mail, 2_000_000)).rejects.toThrow();
    expect(srv.connections).toBe(1);
    expect(srv.dataAttempts).toBe(1);
    expect(srv.delivered).toHaveLength(1);
  });
  it("does not retry a refused recipient or bad password either", async () => {
    srv.mode = "refuse-rcpt";
    await expect(sendMail(cfg(), mail, 3_000_000)).rejects.toThrow(/refused/);
    expect(srv.connections).toBe(1);
    expect(srv.dataAttempts).toBe(0);
    srv.reset();
    await expect(sendMail({ ...cfg(), pass: "wrong" }, mail, 3_100_000)).rejects.toThrow(/Sign-in refused/);
    expect(srv.connections).toBe(1);
  });
  it("checks the message before connecting anywhere", async () => {
    await expect(sendMail(cfg(), { ...mail, to: "not an address" }, 4_000_000)).rejects.toThrow(/To address/);
    await expect(sendMail(cfg(), { to: "you@example.com", subject: "", text: "" }, 4_000_000)).rejects.toThrow(/subject or a message/);
    expect(srv.connections).toBe(0);
  });
  it("stops at 20 sends an hour without contacting the server", async () => {
    const t = 10_000_000;
    for (let i = 0; i < 20; i++) await sendMail(cfg(), mail, t + i);
    srv.reset();
    await expect(sendMail(cfg(), mail, t + 100)).rejects.toThrow(/20 emails/);
    expect(srv.connections).toBe(0);
  });
});

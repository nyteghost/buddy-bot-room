import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { strataChat, strataConfigured, strataModels, strataPrivateBase, StrataError } from "@/lib/strata.server";
import { fieldByKey } from "@/lib/settings";
import { groupItems, INTEGRATIONS } from "@/lib/setup";

const keys = ["STRATA_ENABLED", "STRATA_URL", "STRATA_API_KEY", "STRATA_MODEL"] as const;
const saved = Object.fromEntries(keys.map(k => [k, process.env[k]]));
const fake = "FAKE-TEST-KEY-DO-NOT-USE";
const model = "qwen3.8-flash-next-coder-iq1_m";
const endpoint = "http://100.66.94.14:8090/v1";

const mock = (fn: (url: string, init: RequestInit) => Response | Promise<Response>): typeof fetch =>
  vi.fn(async (url: string | URL | Request, init: RequestInit = {}) => fn(String(url), init)) as unknown as typeof fetch;

beforeEach(() => {
  process.env["STRATA_ENABLED"] = "on";
  process.env["STRATA_URL"] = endpoint;
  process.env["STRATA_API_KEY"] = fake;
  process.env["STRATA_MODEL"] = model;
});
afterEach(() => {
  for (const k of keys) {
    const original = saved[k];
    if (original === undefined) delete process.env[k]; else process.env[k] = original;
  }
  vi.restoreAllMocks();
});

describe("Strata provider foundation (source-only, no active route)", () => {
  it("allows only literal private/LAN/Tailscale IPs with canonical /v1", () => {
    expect(strataPrivateBase(endpoint)).toBe(endpoint);
    expect(strataPrivateBase("http://192.168.1.20:8090")).toBe("http://192.168.1.20:8090/v1");
    expect(strataPrivateBase("http://10.200.1.149:8090/v1/")).toBe("http://10.200.1.149:8090/v1");
    for (const url of [
      "http://8.8.8.8:8090/v1", "https://api.openai.com/v1",
      "http://evil.local:8090/v1", "http://100.128.1.1:8090/v1",
      "http://172.32.0.1:8090/v1", "http://0.0.0.0:8090/v1",
      "http://127.0.0.1:8090/admin", "http://127.0.0.1:8090/v1?key=abc",
      "http://me:secret@127.0.0.1:8090/v1", "file:///etc/passwd",
      "http://[::1]:8090/v1", "http://127.0.0.1:8090/v1#fragment",
      "http://127.0.0.1/v1",
    ]) expect(strataPrivateBase(url)).toBeNull();
  });

  it("stays off by default and never contacts a provider without required private settings", async () => {
    delete process.env["STRATA_ENABLED"];
    const fetcher = mock(() => Response.json({ data: [] }));
    expect(strataConfigured()).toBe(false);
    await expect(strataModels(fetcher)).rejects.toMatchObject({ code: "disabled" });
    expect(fetcher).not.toHaveBeenCalled();
    process.env["STRATA_ENABLED"] = "on";
    process.env["STRATA_URL"] = "https://api.openai.com/v1";
    expect(strataConfigured()).toBe(false);
    await expect(strataModels(fetcher)).rejects.toMatchObject({ code: "config" });
    expect(fetcher).not.toHaveBeenCalled();
  });

  it("authenticates model discovery using only a private URL and does not leak secrets", async () => {
    const fetcher = mock((_url, _init) => Response.json({ object: "list", data: [
      { id: model, status: { value: "loaded" } }, { id: "small", status: { value: "not_loaded" } },
      { id: "../../evil model" }, { foo: 123 },
    ] }));
    const models = await strataModels(fetcher);
    expect(models).toEqual([{ id: model, status: "loaded" }, { id: "small", status: "not_loaded" }]);
    expect(fetcher).toHaveBeenCalledTimes(1);
    const [url, init] = vi.mocked(fetcher).mock.calls[0]!;
    expect(url).toBe(endpoint + "/models");
    expect(init?.redirect).toBe("error");
    expect((init?.headers as Record<string, string>).Authorization).toBe("Bearer " + fake);
    expect(JSON.stringify(models)).not.toContain(fake);
  });

  it("sends a bounded OpenAI-compatible chat and returns only readable content", async () => {
    const fetcher = mock(() => Response.json({
      choices: [{ message: { role: "assistant", content: "Strata connected successfully.",
        reasoning_content: "Sensitive internal thinking not included in output" },
        finish_reason: "stop" }],
    }));
    const reply = await strataChat([{ role: "user", content: "Reply clearly." }], undefined, fetcher);
    expect(reply).toEqual({ text: "Strata connected successfully.", model, truncated: false, finishReason: "stop" });
    const [, init] = vi.mocked(fetcher).mock.calls[0]!;
    const request = JSON.parse(String(init!.body)) as { model: string; max_tokens: number; stream: boolean };
    expect(request).toMatchObject({ model, max_tokens: 1024, stream: false });
    expect(JSON.stringify(reply)).not.toContain(fake);
    expect(init!.signal).toBeTruthy();
  });

  it("distinguishes output budget exhaustion from complete answers", async () => {
    const fetcher = mock(() => Response.json({ choices: [{ message: { content: "Beginning of answer" }, finish_reason: "length" }] }));
    expect((await strataChat([{ role: "user", content: "hi" }], undefined, fetcher)).truncated).toBe(true);
  });

  it("fails closed for authentication, throttling, invalid model and malformed responses", async () => {
    for (const [status, code] of [[401, "auth"], [403, "auth"], [429, "busy"], [404, "model"], [502, "offline"]] as const) {
      await expect(strataModels(mock(() => new Response("do not echo secret", { status })))).rejects.toMatchObject({ code });
    }
    await expect(strataModels(mock(() => Response.json({ wrong: [] })))).rejects.toBeInstanceOf(StrataError);
    await expect(strataChat([{ role: "user", content: "hi" }], "../../bad", mock(() => Response.json({}))))
      .rejects.toMatchObject({ code: "model" });
    await expect(strataChat([{ role: "user", content: "hi" }], model, mock(() => Response.json({ choices: [{ message: { content: "" } }] }))))
      .rejects.toMatchObject({ code: "response" });
    await expect(strataModels(mock(() => new Response("not-json")))).rejects.toMatchObject({ code: "response" });
  });

  it("stops on excessive chunked responses and network failure", async () => {
    const huge = "x".repeat(300_000);
    await expect(strataModels(mock(() => new Response(huge)))).rejects.toMatchObject({ code: "response" });
    await expect(strataModels(mock(() => Promise.reject(new Error("private local endpoint is down")))))
      .rejects.toMatchObject({ code: "offline" });
  });

  it("saves Strata API key only in protected server secrets and groups settings", () => {
    expect(fieldByKey("STRATA_API_KEY")?.secret).toBe(true);
    expect(fieldByKey("STRATA_ENABLED")?.options).toEqual(["off", "on"]);
    expect(INTEGRATIONS.find(i => i.id === "strata")?.testable).toBe(false);
    const items = INTEGRATIONS.map(i => ({ ...i, configured: false }));
    expect(groupItems(items).find(g => g.id === "basics")?.items.some(i => i.id === "strata")).toBe(true);
  });
});

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import * as fs from "node:fs/promises";
import { tmpdir } from "node:os";
import { currentUser, ownerName } from "@/lib/accounts.server";
import { handleChat } from "@/lib/chat.server";
import { handleSetup } from "@/lib/setup.server";
import { askPals } from "@/lib/ask.server";
import { accountFileName } from "@/lib/local-account";
import { agents, models } from "@/lib/agents";

vi.mock("@/lib/accounts.server", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/accounts.server")>()),
  currentUser: vi.fn(),
  ownerName: vi.fn(),
}));

const base = "http://100.80.10.20:8090/v1";
const model = "qwen3.8-flash-next-coder-iq1_m";
const key = "FAKE-KEY-NOT-REAL-STRATA";
let dir = "";
const owner = { username: "owner", owner: true };
const missionId = "aaaaaaaa-aaaa-4aaa-aaaa-aaaaaaaaaaaa";
const mission = (status = "running", revision = 3) => ({
  id: missionId, title: "Owner summary", question: "Summarize the approved work",
  scope: "personal", project: "", status, revision, created: "2026-11-11T12:00:00Z",
  updated: "2026-11-11T12:01:00Z", approvedAt: "2026-11-11T12:00:30Z",
  startedAt: "2026-11-11T12:01:00Z", finishedAt: "", result: "", error: "",
  source: "owner-ui", execution: "local-summary-only",
});
const palRequest = () => new Request("http://localhost/api/chat", {
  method: "POST", headers: { "content-type": "application/json" },
  body: JSON.stringify({
    agentId: agents[0]!.id, model: models[0]!.id, mode: "direct",
    messages: [{ id: "q", role: "user", parts: [{ type: "text", text: "Hello owner" }] }],
    engine: { kind: "strata-server", model: "untrusted-client-model", apiKey: "untrusted-client-key",
      baseUrl: "https://api.openai.com/v1" },
  }),
});
const setupRequest = () => new Request("http://localhost/api/setup", {
  method: "POST", body: JSON.stringify({ id: "strata" }),
});
const stream = () => new Response([
  'data: {"id":"test","object":"chat.completion.chunk","choices":[{"index":0,"delta":{"role":"assistant","content":"Owner response"},"finish_reason":null}]}',
  'data: {"id":"test","object":"chat.completion.chunk","choices":[{"index":0,"delta":{},"finish_reason":"stop"}]}',
  "data: [DONE]", "",
].join("\n\n"), { headers: { "content-type": "text/event-stream" } });

beforeEach(async () => {
  dir = await fs.mkdtemp(tmpdir() + "/pixel-strata-qa-");
  vi.stubEnv("BUDDY_DATA_DIR", dir);
  vi.stubEnv("BUDDY_ACCOUNTS", "1");
  vi.stubEnv("STRATA_ENABLED", "on");
  vi.stubEnv("STRATA_URL", base);
  vi.stubEnv("STRATA_API_KEY", key);
  vi.stubEnv("STRATA_MODEL", model);
  vi.stubEnv("STRATA_FALLBACK", "off");
  vi.stubEnv("LOCAL_ONLY_AI", "on");
  vi.mocked(currentUser).mockReset().mockResolvedValue(owner);
  vi.mocked(ownerName).mockReset().mockResolvedValue("owner");
  await fs.mkdir(dir + "/accounts");
  await fs.writeFile(dir + "/accounts/" + await accountFileName("owner"),
    JSON.stringify({ data: { "pixel-pals-engine-v1": JSON.stringify({ kind: "strata-server", localChat: "auto" }) } }));
  await fs.writeFile(dir + "/working-pals.json", JSON.stringify([mission()]));
});
afterEach(async () => {
  vi.unstubAllEnvs();
  vi.restoreAllMocks();
  await fs.rm(dir, { recursive: true, force: true });
});

describe("independent QA blockers — owner gate, Setup readiness and Working Pals budget", () => {
  it("P1 denies protected Strata when accounts are disabled, even with a forged owner or trusted internal call", async () => {
    const upstream = vi.spyOn(globalThis, "fetch");
    vi.stubEnv("BUDDY_ACCOUNTS", "0");
    expect((await handleChat(palRequest())).status).toBe(403);
    expect((await handleChat(palRequest(), undefined, true)).status).toBe(403);
    vi.stubEnv("BUDDY_ACCOUNTS", "1");
    vi.stubEnv("BUDDY_DATA_DIR", "");
    expect((await handleChat(palRequest())).status).toBe(403);
    expect(upstream).not.toHaveBeenCalled();
  });

  it("P1 denies absent/non-owner sessions before either Strata API request, allows owner", async () => {
    const calls: string[] = [];
    vi.spyOn(globalThis, "fetch").mockImplementation(async (input) => {
      const url = String(input);
      calls.push(url);
      if (url === base + "/models") return Response.json({ data: [{ id: model, status: { value: "loaded" } }] });
      if (url === base + "/chat/completions") return stream();
      throw Error("unexpected outbound request");
    });
    vi.mocked(currentUser).mockResolvedValueOnce(null).mockResolvedValueOnce({ username: "guest", owner: false });
    expect((await handleChat(palRequest())).status).toBe(403);
    expect((await handleChat(palRequest())).status).toBe(403);
    expect(calls).toEqual([]);
    const answer = await handleChat(palRequest());
    expect(answer.ok).toBe(true);
    expect(await answer.text()).toContain("Owner response");
    expect(calls).toEqual([base + "/models", base + "/chat/completions"]);
  });


  it.each([
    [401, "auth"], [404, "model"], [429, "busy"], [503, "offline"],
  ] as const)("P1/P2 live Pal SDK stream cancels unfinished HTTP %i and reports safe %s without cloud fallback", async (status, code) => {
    const canceled = vi.fn();
    const calls: string[] = [];
    vi.spyOn(globalThis, "fetch").mockImplementation(async input => {
      const url = String(input);
      calls.push(url);
      if (url === base + "/models")
        return Response.json({ data: [{ id: model, status: { value: "loaded" } }] });
      if (url === base + "/chat/completions")
        return new Response(new ReadableStream<Uint8Array>({ cancel: canceled }), { status });
      throw Error("Unexpected outbound target");
    });
    const reply = await handleChat(palRequest());
    expect(reply.ok).toBe(true);
    const data = await reply.text();
    expect(data).toContain("strata-" + code);
    expect(data).not.toContain(key);
    expect(canceled).toHaveBeenCalledTimes(1);
    expect(calls).toEqual([base + "/models", base + "/chat/completions"]);
  });

  it("P2 Setup rejects not_loaded and absent models but accepts exactly the loaded model", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue(Response.json({ data: [{ id: model, status: { value: "not_loaded" } }] }));
    const unloaded = await (await handleSetup(setupRequest())).json() as { ok: boolean; note: string };
    expect(unloaded.ok).toBe(false);
    expect(unloaded.note).toMatch(/not loaded/i);
    vi.mocked(fetch).mockResolvedValue(Response.json({ data: [{ id: "different", status: { value: "loaded" } }] }));
    expect(((await (await handleSetup(setupRequest())).json()) as { ok: boolean }).ok).toBe(false);
    vi.mocked(fetch).mockResolvedValue(Response.json({ data: [{ id: model, status: { value: "loaded" } }] }));
    expect(((await (await handleSetup(setupRequest())).json()) as { ok: boolean }).ok).toBe(true);
  });

  it("P2 Setup retains useful safe 401/404/429 and sleeping-PC explanations", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue(new Response(null, { status: 401 }));
    const auth = await (await handleSetup(setupRequest())).json() as { ok: boolean; note: string };
    expect(auth.ok).toBe(false);
    expect(auth.note).toMatch(/API key/i);
    vi.mocked(fetch).mockResolvedValue(new Response(null, { status: 404 }));
    const unavailable = await (await handleSetup(setupRequest())).json() as { ok: boolean; note: string };
    expect(unavailable.note).toMatch(/model|endpoint/i);
    vi.mocked(fetch).mockResolvedValue(new Response(null, { status: 429 }));
    const busy = await (await handleSetup(setupRequest())).json() as { ok: boolean; note: string };
    expect(busy.note).toMatch(/busy/i);
    vi.mocked(fetch).mockRejectedValue(new Error("secret credentials must never be echoed"));
    const offline = await (await handleSetup(setupRequest())).json() as { ok: boolean; note: string };
    expect(offline.note).toMatch(/unreachable/i);
    expect(JSON.stringify([auth, unavailable, busy, offline])).not.toContain(key);
    expect(JSON.stringify(offline)).not.toContain("secret credentials");
  });

  it("P2 honors the approved Working Pals maximum of 900 tokens end to end", async () => {
    const budgets: number[] = [];
    vi.spyOn(globalThis, "fetch").mockImplementation(async (input, init) => {
      const url = String(input);
      if (url === base + "/models") return Response.json({ data: [{ id: model, status: { value: "loaded" } }] });
      if (url === base + "/chat/completions") {
        const data = JSON.parse(String(init?.body)) as { max_tokens: number; tools?: unknown };
        budgets.push(data.max_tokens);
        expect(data).not.toHaveProperty("tools");
        return Response.json({ choices: [{ message: { content: "Approved local summary" }, finish_reason: "stop" }] });
      }
      throw Error("Unexpected provider");
    });
    const approved = await askPals("Provide an authorized read-only summary", { localOnly: true, maxTokens: 900,
      authority: { kind: "approved-working-pal", missionId, revision: 3 },
      system: "You are an approved read-only Working Pal. No tools." });
    expect(approved).toMatchObject({ ok: true, via: "Strata · " + model });
    const smaller = await askPals("Keep it short", { localOnly: true, maxTokens: 80,
      authority: { kind: "owner-request", request: palRequest() } });
    expect(smaller.ok).toBe(true);
    expect(budgets).toEqual([900, 80]);
  });
});

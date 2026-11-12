import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { mkdtemp, mkdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { currentUser, ownerName } from "@/lib/accounts.server";
import { accountFileName } from "@/lib/local-account";
import { assertStrataAuthority, StrataOwnerError } from "@/lib/strata-authority.server";
import { askPals } from "@/lib/ask.server";
import { handleChat } from "@/lib/chat.server";
import { handleFocusFood } from "@/lib/focus-food.server";
import { handleTelegramText } from "@/lib/telegram.server";
import { agents, models } from "@/lib/agents";
import { newMission } from "@/lib/working-pals";

vi.mock("@/lib/accounts.server", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/accounts.server")>()),
  currentUser: vi.fn(),
  ownerName: vi.fn(),
}));

const model = "qa-local-model", base = "http://100.80.10.20:8090/v1";
const id = "aaaaaaaa-aaaa-4aaa-aaaa-aaaaaaaaaaaa";
let dir = "";
const ownerRequest = () => new Request("http://localhost/api/focus-food");
const palRequest = () => new Request("http://localhost/api/chat", {
  method: "POST", body: JSON.stringify({
    agentId: agents[0]!.id, model: models[0]!.id, mode: "direct",
    messages: [{ id: "q", role: "user", parts: [{ type: "text", text: "Hello" }] }],
    engine: { kind: "strata-server" },
  }),
});
async function writeMission(status: "running" | "approved" | "revoked" = "running", revision = 3) {
  const m = newMission({ title: "Summary", question: "Summarize this approved task",
    scope: "personal", project: "" }, id, "2026-11-11T12:00:00Z");
  if (!m) throw Error("Mission fixture unavailable");
  m.status = status; m.revision = revision;
  m.approvedAt = "2026-11-11T12:01:00Z";
  m.startedAt = status === "running" ? "2026-11-11T12:02:00Z" : "";
  await writeFile(join(dir, "working-pals.json"), JSON.stringify([m]));
}
function fakeInference(calls: string[]) {
  return vi.spyOn(globalThis, "fetch").mockImplementation(async (input, init) => {
    const url = String(input); calls.push(url);
    if (url === base + "/models")
      return Response.json({ data: [{ id: model, status: { value: "loaded" } }] });
    if (url === base + "/chat/completions") {
      const data = JSON.parse(String(init?.body)) as { max_tokens: number };
      expect(data.max_tokens).toBeGreaterThan(0);
      return Response.json({ model, choices: [{ message: { content: "Approved local summary" }, finish_reason: "stop" }] });
    }
    throw Error("Unexpected network call");
  });
}
beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), "pixel-strata-final-"));
  await mkdir(join(dir, "accounts"));
  vi.stubEnv("BUDDY_DATA_DIR", dir);
  vi.stubEnv("BUDDY_ACCOUNTS", "1");
  vi.stubEnv("STRATA_ENABLED", "on");
  vi.stubEnv("STRATA_URL", base);
  vi.stubEnv("STRATA_API_KEY", "TEST-ONLY-NO-REAL-KEY");
  vi.stubEnv("STRATA_MODEL", model);
  vi.stubEnv("STRATA_FALLBACK", "off");
  vi.stubEnv("LOCAL_ONLY_AI", "on");
  vi.stubEnv("TELEGRAM_BOT_TOKEN", "12345:abcdefghijklmnopqrstuvwxyz");
  vi.stubEnv("TELEGRAM_CHAT_ID", "12345678");
  vi.mocked(currentUser).mockReset().mockResolvedValue({ username: "owner", owner: true });
  vi.mocked(ownerName).mockReset().mockResolvedValue("owner");
  await writeFile(join(dir, "accounts", await accountFileName("owner")),
    JSON.stringify({ data: { "pixel-pals-engine-v1": JSON.stringify({ kind: "strata-server", localChat: "auto" }) } }));
  await writeMission();
});
afterEach(async () => {
  vi.restoreAllMocks();
  vi.unstubAllEnvs();
  await rm(dir, { recursive: true, force: true });
});

describe("final QA: shared protected Strata owner and unattended authority", () => {
  it("denies all authorities and saved owner settings when accounts are disabled; no model discovery", async () => {
    const calls: string[] = []; fakeInference(calls);
    vi.stubEnv("BUDDY_ACCOUNTS", "0");
    for (const authority of [
      { kind: "owner-request" as const, request: ownerRequest() },
      { kind: "approved-working-pal" as const, missionId: id, revision: 3 },
      { kind: "owner-telegram" as const, chatId: "12345678" },
    ]) await expect(assertStrataAuthority(authority)).rejects.toBeInstanceOf(StrataOwnerError);
    expect((await handleChat(palRequest())).status).toBe(403);
    expect((await handleChat(palRequest(), undefined, true)).status).toBe(403);
    const unattended = await askPals("Read-only summary", { authority: { kind: "approved-working-pal", missionId: id, revision: 3 } });
    expect(unattended.ok).toBe(false);
    const recipe = { title: "Rice", ingredients: ["1 cup rice"], steps: ["Rest 5 minutes."], source: "", servings: "2", nutrition: "" };
    const food = await handleFocusFood(new Request("http://localhost/api/focus-food", {
      method: "POST", body: JSON.stringify({ op: "chat", recipe, question: "Why rest?", index: 0, stage: "cook", history: [] }),
    }));
    expect(food.status).toBe(503);
    expect(calls).toEqual([]);
  });

  it("requires a verifiable owner request, not a trusted server flag, on direct Pal and askPals paths", async () => {
    const calls: string[] = []; fakeInference(calls);
    vi.mocked(currentUser).mockResolvedValue(null);
    await expect(assertStrataAuthority({ kind: "owner-request", request: ownerRequest() }))
      .rejects.toBeInstanceOf(StrataOwnerError);
    expect((await handleChat(palRequest(), undefined, true)).status).toBe(403);
    expect((await askPals("Hello")).ok).toBe(false);
    expect(calls).toEqual([]);
    vi.mocked(currentUser).mockResolvedValue({ username: "guest", owner: false });
    expect((await askPals("Hello", { authority: { kind: "owner-request", request: ownerRequest() } })).ok).toBe(false);
    expect(calls).toEqual([]);
    vi.mocked(currentUser).mockResolvedValue({ username: "owner", owner: true });
    const answer = await askPals("Authorized owner answer", {
      localOnly: true, authority: { kind: "owner-request", request: ownerRequest() },
      maxTokens: 80,
    });
    expect(answer).toMatchObject({ ok: true, via: "Strata · " + model });
    expect(calls).toEqual([base + "/models", base + "/chat/completions"]);
  });

  it("runs approved Working Pals only at exact running revision; revoked/proposed/stale missions fail", async () => {
    const calls: string[] = []; fakeInference(calls);
    const auth = { kind: "approved-working-pal" as const, missionId: id, revision: 3 };
    for (const status of ["approved", "revoked"] as const) {
      await writeMission(status);
      expect((await askPals("Summary", { localOnly: true, authority: auth })).ok).toBe(false);
    }
    await writeMission("running", 4);
    expect((await askPals("Summary", { localOnly: true, authority: auth })).ok).toBe(false);
    await writeMission("running", 3);
    expect((await askPals("Summary", { localOnly: true, maxTokens: 900, authority: auth })).ok).toBe(true);
    expect(calls).toEqual([base + "/models", base + "/chat/completions"]);
  });

  it("requires exact configured owner Telegram chat, enabled bot and enabled local accounts", async () => {
    const calls: string[] = []; fakeInference(calls);
    expect((await handleTelegramText("Hello pals", "87654321"))).toBeNull();
    await expect(assertStrataAuthority({ kind: "owner-telegram", chatId: "87654321" }))
      .rejects.toBeInstanceOf(StrataOwnerError);
    vi.stubEnv("TELEGRAM_BOT_TOKEN", "");
    await expect(assertStrataAuthority({ kind: "owner-telegram", chatId: "12345678" }))
      .rejects.toBeInstanceOf(StrataOwnerError);
    expect(calls).toEqual([]);
    vi.stubEnv("TELEGRAM_BOT_TOKEN", "12345:abcdefghijklmnopqrstuvwxyz");
    const response = await handleTelegramText("Hello pals", "12345678");
    expect(response).toContain("Approved local summary");
    expect(calls).toEqual([base + "/models", base + "/chat/completions"]);
  });

  it("does not let retained engine settings grant authority without an owner account", async () => {
    const calls: string[] = []; fakeInference(calls);
    vi.mocked(ownerName).mockResolvedValue(null);
    expect((await askPals("Summary", { authority: { kind: "approved-working-pal", missionId: id, revision: 3 } })).ok).toBe(false);
    expect((await askPals("Summary", { authority: { kind: "owner-telegram", chatId: "12345678" } })).ok).toBe(false);
    expect(calls).toEqual([]);
  });
});

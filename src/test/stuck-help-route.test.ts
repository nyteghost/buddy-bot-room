import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { currentUser } from "@/lib/accounts.server";
import { askPals } from "@/lib/ask.server";
import { handleStuckHelp } from "@/lib/stuck-help.server";
vi.mock("@/lib/accounts.server", () => ({ currentUser: vi.fn() }));
vi.mock("@/lib/ask.server", () => ({ askPals: vi.fn() }));
const owner = vi.mocked(currentUser), ai = vi.mocked(askPals);
const request = (body: unknown) => new Request("http://localhost/api/focus-help", { method: "POST", body: JSON.stringify(body) });
beforeEach(() => { vi.stubEnv("BUDDY_ACCOUNTS", "1"); vi.stubEnv("BUDDY_DATA_DIR", "/tmp/pixel-stuck-test"); owner.mockReset(); ai.mockReset(); owner.mockResolvedValue({ username: "owner", owner: true }); });
afterEach(() => vi.unstubAllEnvs());
describe("private stuck coaching", () => {
  it("denies guest requests before inference", async () => {
    owner.mockResolvedValue({ username: "guest", owner: false });
    expect((await handleStuckHelp(request({ task: "Read mail", step: "Open inbox", choice: "sample" }))).status).toBe(403); expect(ai).not.toHaveBeenCalled();
  });
  it("rejects invalid or oversized inputs", async () => {
    expect((await handleStuckHelp(request({ task: "", choice: "smaller" }))).status).toBe(400);
    expect((await handleStuckHelp(request({ task: "Email", choice: "send" }))).status).toBe(400);
    expect((await handleStuckHelp(request({ task: "x".repeat(5000), choice: "explain" }))).status).toBe(413); expect(ai).not.toHaveBeenCalled();
  });
  it("uses local AI only and treats the current step as quoted data", async () => {
    ai.mockResolvedValue({ ok: true, text: "Write just the heading. That is enough.", via: "Local AI" });
    const result = await handleStuckHelp(request({ task: "Write a report", step: "Draft the first paragraph", choice: "explain" }));
    expect(await result.json()).toMatchObject({ source: "local-ai", choice: "explain" });
    expect(ai).toHaveBeenCalledWith(expect.stringContaining('"step":"Draft the first paragraph"'), expect.objectContaining({ localOnly: true, signal: expect.any(AbortSignal) }));
  });
  it.each(["smaller", "explain", "sample"])("provides %s help when Ollama is unavailable", async choice => {
    ai.mockResolvedValue({ ok: false, error: "Offline" });
    const result = await handleStuckHelp(request({ task: "Write a report", step: "Draft one paragraph", choice }));
    expect(await result.json()).toMatchObject({ source: "offline", choice, text: expect.any(String) });
  });
  it("rejects unsafe invented assembly steps and false access claims", async () => {
    ai.mockResolvedValue({ ok: true, text: "Drill into the beam.", via: "Local AI" });
    expect(await (await handleStuckHelp(request({ task: "Build a swingset", choice: "smaller" }))).json()).toMatchObject({ source: "offline" });
    ai.mockResolvedValue({ ok: true, text: "I opened your inbox and sent it.", via: "Local AI" });
    expect(await (await handleStuckHelp(request({ task: "Write a reply", choice: "sample" }))).json()).toMatchObject({ source: "offline" });
  });
});

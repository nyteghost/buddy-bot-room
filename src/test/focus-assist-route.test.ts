import { beforeEach, afterEach, describe, expect, it, vi } from "vitest";
import { currentUser } from "@/lib/accounts.server";
import { askPals } from "@/lib/ask.server";
import { handleJustStart } from "@/lib/focus-assist.server";

vi.mock("@/lib/accounts.server", () => ({ currentUser: vi.fn() }));
vi.mock("@/lib/ask.server", () => ({ askPals: vi.fn() }));
const user = vi.mocked(currentUser);
const ai = vi.mocked(askPals);
const req = (body: unknown) => new Request("http://localhost/api/just-start", {
  method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body),
});
beforeEach(() => {
  vi.stubEnv("BUDDY_ACCOUNTS", "1");
  user.mockReset();
  ai.mockReset();
  user.mockResolvedValue({ username: "owner", owner: true });
});
afterEach(() => { vi.unstubAllEnvs(); });

describe("Just Start local coaching route", () => {
  it("never calls an AI or reveals data to guests", async () => {
    user.mockResolvedValue({ username: "guest", owner: false });
    expect((await handleJustStart(req({ task: "Email someone", action: "first" }))).status).toBe(403);
    user.mockResolvedValue(null);
    expect((await handleJustStart(req({ task: "Email someone", action: "first" }))).status).toBe(403);
    expect(ai).not.toHaveBeenCalled();
  });
  it("validates the user request before inference", async () => {
    expect((await handleJustStart(req({ task: "", action: "first" }))).status).toBe(400);
    expect((await handleJustStart(req({ task: "Email", action: "delete" }))).status).toBe(400);
    expect((await handleJustStart(req({ task: "x".repeat(350), action: "first" }))).status).toBe(400);
    expect(ai).not.toHaveBeenCalled();
  });
  it("uses only Local AI with a short output limit", async () => {
    ai.mockResolvedValue({ ok: true, text: "1. Open the email app.\n2. Write a novel.", via: "Local AI" });
    const response = await handleJustStart(req({ task: "Reply to Brian", action: "first" }));
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ step: "Open the email app.", source: "local-ai" });
    expect(ai).toHaveBeenCalledWith(expect.stringContaining('"Reply to Brian"'), expect.objectContaining({ localOnly: true, maxTokens: 100 }));
  });
  it("provides the offline quick step if local inference fails", async () => {
    ai.mockResolvedValue({ ok: false, error: "Ollama offline" });
    const response = await handleJustStart(req({ task: "Finish a report", action: "first" }));
    expect(await response.json()).toEqual({ step: "Open the file or tool you'll use. That's the only step right now.", source: "quick-start" });
  });
});

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
  vi.stubEnv("BUDDY_DATA_DIR", "/tmp/pixelpals-focus-route-tests");
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
  it("uses only Local AI and gives it numbered progress rather than starting over", async () => {
    ai.mockResolvedValue({ ok: true, text: "1. Lay out the swingset parts.\n2. Assemble everything.", via: "Local AI" });
    const response = await handleJustStart(req({ task: "Build a swingset", action: "next", stepNumber: 2, previous: "Find the manual", completed: ["Find the manual"] }));
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ step: "Lay out the swingset parts.", source: "local-ai" });
    expect(ai).toHaveBeenCalledWith(expect.stringContaining('Current small-step number: 2'), expect.objectContaining({ localOnly: true, maxTokens: 120 }));
    const prompt = ai.mock.calls[0]![0];
    expect(prompt).toContain('"Find the manual"');
  });
  it("provides a useful next offline step if local inference fails", async () => {
    ai.mockResolvedValue({ ok: false, error: "Ollama offline" });
    const response = await handleJustStart(req({ task: "Build a swingset", action: "next", stepNumber: 2, previous: "Find the assembly manual and place it next to the parts.", completed: ["Find the assembly manual and place it next to the parts."] }));
    const result = await response.json();
    expect(result.source).toBe("quick-start");
    expect(result.step).toMatch(/Lay out the pieces/);
  });
});

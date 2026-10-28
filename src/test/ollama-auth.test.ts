import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { currentUser } from "@/lib/accounts.server";
import { handleOllamaApi } from "@/lib/ollama.server";

vi.mock("@/lib/accounts.server", () => ({ currentUser: vi.fn() }));
const mockUser = vi.mocked(currentUser);

const request = (action: string, model = "qwen2.5:7b") => new Request("http://localhost/api/ollama", {
  method: "POST",
  headers: { "content-type": "application/json" },
  body: JSON.stringify({ action, model }),
});

describe("Ollama management authorization", () => {
  beforeEach(() => {
    vi.stubEnv("BUDDY_DATA_DIR", "/tmp/pixelpals-test-auth");
    vi.stubEnv("BUDDY_ACCOUNTS", "1");
    vi.stubEnv("OLLAMA_URL", "http://ollama:11434");
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response(null, { status: 200 })));
    mockUser.mockReset();
  });
  afterEach(() => {
    vi.unstubAllEnvs();
    vi.unstubAllGlobals();
    vi.clearAllMocks();
  });

  it.each(["pull", "delete", "bench", "refresh-feed"])("denies non-owners the %s operation", async (action) => {
    mockUser.mockResolvedValue({ username: "guest", owner: false });
    const response = await handleOllamaApi(request(action));
    expect(response.status).toBe(403);
    expect(vi.mocked(fetch)).not.toHaveBeenCalled();
  });

  it("denies unauthenticated management requests", async () => {
    mockUser.mockResolvedValue(null);
    expect((await handleOllamaApi(request("delete"))).status).toBe(403);
    expect(vi.mocked(fetch)).not.toHaveBeenCalled();
  });

  it("allows the owner to delete a model", async () => {
    mockUser.mockResolvedValue({ username: "owner", owner: true });
    const response = await handleOllamaApi(request("delete"));
    expect(response.ok).toBe(true);
    expect(vi.mocked(fetch)).toHaveBeenCalledTimes(1);
  });
});

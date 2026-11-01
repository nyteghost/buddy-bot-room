import { beforeEach, afterEach, expect, it, vi } from "vitest";
import { currentUser } from "@/lib/accounts.server";
import { ensureSettings, saveSettings } from "@/lib/settings.server";
import { handleOllamaConnect } from "@/lib/ollama-connect.server";
import { ollamaConnectUrl } from "@/lib/ollama-connect";
vi.mock("@/lib/accounts.server", () => ({ currentUser: vi.fn() }));
vi.mock("@/lib/settings.server", () => ({ ensureSettings: vi.fn(), saveSettings: vi.fn() }));
const user = vi.mocked(currentUser), save = vi.mocked(saveSettings);
const network = vi.fn();
const request = (body: unknown) => new Request("http://localhost/api/ollama-connect", { method: "POST", body: JSON.stringify(body) });
beforeEach(() => { user.mockResolvedValue({ username: "owner", owner: true }); save.mockReset(); vi.mocked(ensureSettings).mockResolvedValue(); network.mockReset(); vi.stubGlobal("fetch", network); });
afterEach(() => vi.unstubAllGlobals());
it("requires owner access before settings or network requests", async () => {
  user.mockResolvedValue({ username: "guest", owner: false });
  expect((await handleOllamaConnect(request({ op: "test", url: "http://pc:11434" }))).status).toBe(403);
  expect(network).not.toHaveBeenCalled(); expect(save).not.toHaveBeenCalled();
});
it.each(["file:///etc/passwd", "http://user:pass@pc:11434", "http://pc:11434?token=secret", "http://169.254.169.254", "http://pc/../../etc?x=y"])("rejects invalid endpoint %s", async url => {
  expect((await handleOllamaConnect(request({ op: "test", url }))).status).toBe(400); expect(network).not.toHaveBeenCalled();
});
it("normalizes familiar API suffixes without changing the host", () => { expect(ollamaConnectUrl("http://pc:11434/v1/")).toBe("http://pc:11434"); expect(ollamaConnectUrl("http://pc:11434/api/tags")).toBe("http://pc:11434"); });
it("tests only the entered tags endpoint, refuses redirects and does not save", async () => {
  network.mockResolvedValue(Response.json({ models: [{ name: "qwen2.5:7b" }, { name: "qwen2.5:7b" }, { name: "model:cloud" }, { name: "bad name" }] }));
  const response = await handleOllamaConnect(request({ op: "test", url: "http://pc:11434" }));
  expect(await response.json()).toMatchObject({ saved: false, models: ["qwen2.5:7b"] });
  expect(network).toHaveBeenCalledWith("http://pc:11434/api/tags", expect.objectContaining({ method: "GET", redirect: "error", signal: expect.any(AbortSignal) })); expect(save).not.toHaveBeenCalled();
});
it("retests the chosen model before saving and never saves an absent model", async () => {
  network.mockImplementation(() => Promise.resolve(Response.json({ models: [{ name: "qwen2.5:7b" }] })));
  expect((await handleOllamaConnect(request({ op: "connect", url: "http://pc:11434", model: "missing:7b" }))).status).toBe(400); expect(save).not.toHaveBeenCalled();
  save.mockResolvedValue({ saved: ["OLLAMA_URL"], errors: {} });
  const response = await handleOllamaConnect(request({ op: "connect", url: "http://pc:11434", model: "qwen2.5:7b" }));
  expect(await response.json()).toMatchObject({ saved: true, model: "qwen2.5:7b" }); expect(save).toHaveBeenCalledWith({ OLLAMA_URL: "http://pc:11434" });
});
it("does not change a working address when tests fail or response is not Ollama", async () => {
  network.mockRejectedValueOnce(new Error("private connection details"));
  const response = await handleOllamaConnect(request({ op: "connect", url: "http://pc:11434", model: "qwen2.5:7b" }));
  expect(response.status).toBe(502); expect(await response.text()).not.toContain("private connection details");
  network.mockResolvedValueOnce(Response.json({ notModels: [] }));
  expect((await handleOllamaConnect(request({ op: "test", url: "http://pc:11434" }))).status).toBe(502); expect(save).not.toHaveBeenCalled();
});
it("reports failed persistence without claiming a successful connection", async () => {
  network.mockResolvedValue(Response.json({ models: [{ name: "qwen2.5:7b" }] })); save.mockResolvedValue({ saved: [], errors: { _: "Read-only volume" } });
  expect((await handleOllamaConnect(request({ op: "connect", url: "http://pc:11434", model: "qwen2.5:7b" }))).status).toBe(500);
});
it("bounds payloads and upstream responses", async () => {
  expect((await handleOllamaConnect(request({ url: "x".repeat(5000) }))).status).toBe(413);
  network.mockResolvedValue(new Response("x".repeat(200001)));
  expect((await handleOllamaConnect(request({ op: "test", url: "http://pc:11434" }))).status).toBe(502); expect(save).not.toHaveBeenCalled();
});

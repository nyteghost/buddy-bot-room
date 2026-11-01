import { engineFromJson, localServerProvider } from "@/lib/engine";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { render, screen, cleanup } from "@testing-library/react";
import { handleOllamaApi } from "@/lib/ollama.server";
import { currentUser } from "@/lib/accounts.server";
import { handleOllamaHealth, readOllamaHealth } from "@/lib/ollama-health.server";
import {
  EMPTY_OLLAMA_HEALTH,
  installedName,
  modelProblem,
  serverOllamaTransport,
} from "@/lib/ollama-health";
import { bestInstalled } from "@/lib/model-catalog";
import { hostHardware } from "@/lib/ollama-resources";
vi.mock("@/lib/accounts.server", () => ({ currentUser: vi.fn() }));
vi.mock("@/lib/settings.server", () => ({ ensureSettings: vi.fn() }));
const network = vi.fn();
beforeEach(() => {
  vi.stubGlobal("fetch", network);
  network.mockReset();
  vi.mocked(currentUser).mockResolvedValue({ username: "owner", owner: true });
  vi.stubEnv("OLLAMA_URL", "http://remote-pc:11434");
  vi.stubEnv("LOCAL_ONLY_AI", "on");
});
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
});
describe("server-authoritative remote Ollama health", () => {
  it("protects model discovery before contacting the internal endpoint", async () => {
    vi.mocked(currentUser).mockResolvedValue(null);
    expect((await handleOllamaHealth(new Request("http://app/api/ollama-health"))).status).toBe(
      403,
    );
    expect(network).not.toHaveBeenCalled();
  });
  it("also protects the detailed legacy status endpoint from signed-in guests", async () => {
    vi.mocked(currentUser).mockResolvedValue({ username: "guest", owner: false });
    expect((await handleOllamaApi(new Request("http://app/api/ollama"))).status).toBe(403);
    expect(network).not.toHaveBeenCalled();
  });
  it("reports reachable, remote and Local-Only without exposing addresses or secrets", async () => {
    network.mockResolvedValue(
      Response.json({
        models: [{ name: "qwen3.5:9b", size: 6 * 1024 ** 3 }, { name: "model:cloud" }],
      }),
    );
    const response = await handleOllamaHealth(
      new Request("http://app/api/ollama-health?url=http://untrusted"),
    );
    const data = await response.json();
    expect(data).toMatchObject({
      state: "connected",
      remote: true,
      localOnly: true,
      models: [{ name: "qwen3.5:9b", gb: 6 }],
    });
    expect(JSON.stringify(data)).not.toContain("remote-pc");
    expect(response.headers.get("cache-control")).toBe("no-store");
    expect(network).toHaveBeenCalledWith(
      "http://remote-pc:11434/api/tags",
      expect.objectContaining({ redirect: "error", signal: expect.any(AbortSignal) }),
    );
  });
  it("distinguishes an offline configured host from missing configuration", async () => {
    network.mockRejectedValue(new Error("connect refused with private diagnostic"));
    expect(await readOllamaHealth()).toMatchObject({ state: "offline", configured: true });
    vi.stubEnv("OLLAMA_URL", "");
    expect(await readOllamaHealth()).toMatchObject({ state: "configuration", configured: false });
  });
  it("bounds upstream model metadata", async () => {
    network.mockResolvedValue(new Response("x".repeat(200001)));
    expect((await readOllamaHealth()).state).toBe("offline");
  });
  it("uses backend health for Auto modes, including while checking and in Local-Only", () => {
    expect(serverOllamaTransport("auto", EMPTY_OLLAMA_HEALTH)).toBe(true);
    expect(
      serverOllamaTransport(undefined, {
        ...EMPTY_OLLAMA_HEALTH,
        state: "connected",
        configured: true,
      }),
    ).toBe(true);
    expect(serverOllamaTransport("browser", { ...EMPTY_OLLAMA_HEALTH, localOnly: true })).toBe(
      true,
    );
    expect(serverOllamaTransport("browser", EMPTY_OLLAMA_HEALTH)).toBe(false);
    expect(serverOllamaTransport("auto", { ...EMPTY_OLLAMA_HEALTH, state: "configuration" })).toBe(
      false,
    );
  });
  it("prefers the installed general model and distinguishes missing explicit assignments", () => {
    const models = [
      { name: "qwen3.5:9b", gb: 6 },
      { name: "qwen3:8b", gb: 5 },
      { name: "qwen2.5-coder:7b", gb: 4.7 },
    ];
    expect(bestInstalled("chat", models, null)).toBe("qwen3.5:9b");
    expect(bestInstalled("code", models, null)).toBe("qwen2.5-coder:7b");
    expect(
      modelProblem(
        "llama3.2:3b",
        models.map((m) => m.name),
      ),
    ).toContain("not installed");
    expect(
      installedName(
        "qwen3.5:9b",
        models.map((m) => m.name),
      ),
    ).toBe("qwen3.5:9b");
    expect(installedName("custom", ["custom:latest"])).toBe("custom:latest");
  });
  it("never borrows Unraid CPU or RAM for an unknown remote processing host", () => {
    expect(
      hostHardware(
        { cpu: "i5-8500", cores: 6, ramGb: 32, gpus: [], gpuSource: "none" },
        { remote: true, gb: 0, source: "unknown" },
      ),
    ).toMatchObject({ cpu: "Remote CPU unknown", cores: 0, ramGb: 0, gpus: [] });
  });
});

it("backend modes share the installed default and preserve explicit Pal assignments without memory substitution", () => {
  for (const kind of ["local-server", "ollama", "auto-ollama"]) {
    const settings = engineFromJson(
      JSON.stringify({
        kind,
        localChat: "qwen3.5:9b",
        localAuto: false,
        ollamaModel: "llama3.2:3b",
        localPals: { nova: "qwen2.5-coder:7b" },
      }),
    );
    expect(localServerProvider(settings).model).toBe("qwen3.5:9b");
    expect(localServerProvider(settings, { agentId: "nova" })).toMatchObject({
      model: "qwen2.5-coder:7b",
      noFallback: true,
    });
    expect(settings.ollamaModel).toBe("llama3.2:3b");
  }
});

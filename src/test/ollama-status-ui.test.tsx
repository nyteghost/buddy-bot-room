import { beforeEach, afterEach, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { OllamaMascot } from "@/components/ollama-mascot";
import { OllamaModelSettings } from "@/components/ollama-model-settings";
import { setEngine } from "@/lib/engine";
import { useOllamaHealth } from "@/lib/ollama-health-store";
import { EMPTY_OLLAMA_HEALTH } from "@/lib/ollama-health";
const engine = {
  kind: "auto-ollama",
  ollamaUrl: "http://browser-cannot-reach:11434",
  ollamaTransport: "auto",
  ollamaModel: "qwen3.5:9b",
  localChat: "qwen3.5:9b",
  localCode: "",
  localReasoning: "",
  localFast: "",
  localPals: { nova: "missing:7b" } as Record<string, string>,
};
vi.mock("@/lib/engine", () => ({ useEngine: () => engine, setEngine: vi.fn() }));
vi.mock("@/lib/ollama-health-store", () => ({ useOllamaHealth: vi.fn() }));
beforeEach(() => {
  vi.mocked(useOllamaHealth).mockReturnValue({
    ...EMPTY_OLLAMA_HEALTH,
    state: "connected",
    configured: true,
    reachable: true,
    remote: true,
    models: [{ name: "qwen3.5:9b", gb: 6 }],
  });
  vi.mocked(setEngine).mockReset();
  vi.stubGlobal("fetch", vi.fn());
});
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});
it("Auto reports a missing Pal model separately from online backend health, without direct browser probes", () => {
  render(<OllamaMascot />);
  expect(screen.getByText("Local AI — Model unavailable")).toBeInTheDocument();
  expect(screen.getByText(/Remote Ollama via Pixel Pals/)).toBeInTheDocument();
  expect(fetch).not.toHaveBeenCalled();
});
it("shows Checking, configuration and Offline as distinct states", () => {
  vi.mocked(useOllamaHealth).mockReturnValue(EMPTY_OLLAMA_HEALTH);
  const { rerender } = render(<OllamaMascot />);
  expect(screen.getByText("Local AI — Checking")).toBeInTheDocument();
  vi.mocked(useOllamaHealth).mockReturnValue({ ...EMPTY_OLLAMA_HEALTH, state: "configuration" });
  engine.ollamaTransport = "server";
  rerender(<OllamaMascot />);
  expect(screen.getByText("Local AI — Configuration required")).toBeInTheDocument();
  vi.mocked(useOllamaHealth).mockReturnValue({
    ...EMPTY_OLLAMA_HEALTH,
    state: "offline",
    configured: true,
  });
  rerender(<OllamaMascot />);
  expect(screen.getByText("Local AI — Offline")).toBeInTheDocument();
  engine.ollamaTransport = "auto";
});
it("only changes the explicitly approved Pal override", () => {
  render(<OllamaModelSettings />);
  expect(setEngine).not.toHaveBeenCalled();
  fireEvent.click(screen.getByRole("button", { name: "Use replacement for Pal nova" }));
  expect(setEngine).toHaveBeenCalledWith({ localPals: { nova: "qwen3.5:9b" } });
});

it("reports Connected for backend Auto even if the browser URL is unreachable", () => {
  const previous = engine.localPals;
  engine.localPals = {};
  render(<OllamaMascot />);
  expect(screen.getByText("Local AI — Connected")).toBeInTheDocument();
  expect(fetch).not.toHaveBeenCalled();
  engine.localPals = previous;
});

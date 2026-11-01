import { beforeEach, afterEach, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { LocalAiPanel } from "@/components/local-ai-panel";
import { OllamaConnect } from "@/components/ollama-connect";
import { setEngine } from "@/lib/engine";
vi.mock("@/lib/engine", () => ({ setEngine: vi.fn(), useEngine: () => ({ localChat: "qwen2.5:7b" }) }));
const network = vi.fn();
beforeEach(() => { network.mockReset(); vi.mocked(setEngine).mockReset(); vi.stubGlobal("fetch", network); });
afterEach(() => { cleanup(); vi.unstubAllGlobals(); });
it("shows Test and Save, tests without saving, then switches only after confirmed save", async () => {
  network.mockImplementation(async (url: string, init?: RequestInit) => {
    if (url === "/api/settings") return Response.json({ settings: [] });
    const body = JSON.parse(init!.body as string);
    return Response.json({ ok: true, saved: body.op === "connect", models: ["qwen2.5:7b"], model: body.model });
  });
  render(<OllamaConnect />);
  expect(screen.getByRole("button", { name: "Save and connect" })).toBeDisabled();
  fireEvent.change(screen.getByLabelText("Ollama server address"), { target: { value: "http://pc:11434" } });
  fireEvent.click(screen.getByRole("button", { name: "Test connection" }));
  await screen.findByRole("combobox", { name: "Installed local model" }); expect(setEngine).not.toHaveBeenCalled();
  fireEvent.click(screen.getByRole("button", { name: "Save and connect" }));
  await waitFor(() => expect(setEngine).toHaveBeenCalledWith({ kind: "local-server", ollamaTransport: "server", ollamaModel: "qwen2.5:7b", localChat: "qwen2.5:7b", localAuto: false }));
});
it("invalidates tested models and ignores an old reply when the address changes", async () => {
  let resolve: (response: Response) => void = () => {};
  network.mockImplementation((url: string) => url === "/api/settings" ? Promise.resolve(Response.json({ settings: [] })) : new Promise<Response>(r => { resolve = r; }));
  render(<OllamaConnect />);
  fireEvent.change(screen.getByLabelText("Ollama server address"), { target: { value: "http://old-pc:11434" } });
  fireEvent.click(screen.getByRole("button", { name: "Test connection" }));
  fireEvent.change(screen.getByLabelText("Ollama server address"), { target: { value: "http://new-pc:11434" } });
  resolve(Response.json({ ok: true, saved: false, models: ["old:7b"] }));
  await waitFor(() => expect(screen.getByRole("button", { name: "Test connection" })).not.toBeDisabled());
  expect(screen.queryByRole("combobox", { name: "Installed local model" })).not.toBeInTheDocument(); expect(setEngine).not.toHaveBeenCalled();
});
it("keeps connection controls and actionable errors visible after an unreachable host", async () => {
  network.mockImplementation(async (url: string) => url === "/api/settings" ? Response.json({ settings: [] }) : Response.json({ error: "PC is not reachable. Check the firewall." }, { status: 502 }));
  render(<OllamaConnect />); fireEvent.change(screen.getByLabelText("Ollama server address"), { target: { value: "http://pc:11434" } });
  fireEvent.click(screen.getByRole("button", { name: "Test connection" }));
  await screen.findByText("PC is not reachable. Check the firewall."); expect(screen.getByRole("button", { name: "Save and connect" })).toBeDisabled(); expect(setEngine).not.toHaveBeenCalled();
});

it("keeps a typed address when the Local AI status finishes loading", async () => {
  let resolveStatus: (response: Response) => void = () => {};
  network.mockImplementation((url: string) => url === "/api/settings" ? Promise.resolve(Response.json({ settings: [] })) : new Promise<Response>(resolve => { resolveStatus = resolve; }));
  render(<LocalAiPanel />);
  fireEvent.change(screen.getByLabelText("Ollama server address"), { target: { value: "http://my-pc:11434" } });
  resolveStatus(Response.json({ configured: false }));
  await waitFor(() => expect(screen.queryByText("Checking the Local AI server…")).not.toBeInTheDocument());
  expect(screen.getByLabelText("Ollama server address")).toHaveValue("http://my-pc:11434");
});

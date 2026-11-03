import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { SetupPanel } from "@/components/setup-panel";

vi.mock("@/components/ollama-connect", () => ({ OllamaConnect: () => <div>Local AI connection</div> }));
vi.mock("@/components/addons", () => ({ AddonSettings: () => <div>Optional add-ons</div> }));
vi.mock("@/components/maintenance-panels", () => ({
  BackupSection: () => <div>Backup controls</div>,
  SchedulesSection: () => <div>Schedules controls</div>,
}));
const calls = vi.fn();
beforeEach(() => {
  calls.mockImplementation(async (input: RequestInfo | URL) => {
    if (String(input).includes("/api/setup")) return Response.json({ items: [
      { id: "ollama", name: "Local AI (Ollama)", what: "Local GPU", env: "OLLAMA_URL", configured: true, testable: true },
      { id: "discord", name: "Discord Companion", what: "Chat on mobile", env: "DISCORD_BOT_TOKEN", configured: true, testable: true },
      { id: "calendar", name: "Calendar feeds", what: "Outlook ICS", env: "CALENDAR_ICS_URLS", configured: false, testable: true },
    ]});
    return Response.json({ settings: [
      { key: "DISCORD_BOT_TOKEN", label: "Discord bot token", group: "discord", kind: "text", secret: true, source: "app" },
      { key: "CALENDAR_ICS_URLS", label: "Calendar feed links", group: "calendar", kind: "list", secret: true, source: "none" },
    ]});
  });
  vi.stubGlobal("fetch", calls);
});
afterEach(() => { cleanup(); vi.unstubAllGlobals(); });
it("shows only the selected category, supports search and keeps secrets collapsed", async () => {
  render(<SetupPanel open />);
  expect(await screen.findByText("Local AI connection")).toBeInTheDocument();
  expect(screen.queryByText("Discord Companion")).not.toBeInTheDocument();
  fireEvent.click(screen.getByRole("button", { name: /Phone & reminders/ }));
  expect(await screen.findByText("Discord Companion")).toBeInTheDocument();
  fireEvent.click(screen.getByRole("button", { name: /Edit/ }));
  expect(screen.getByText("Discord bot token")).toBeInTheDocument();
  expect(screen.queryByDisplayValue("super-secret")).not.toBeInTheDocument();
  fireEvent.change(screen.getByRole("textbox", { name: "Find a setting" }), { target: { value: "calendar feed links" } });
  expect(await screen.findByText("Calendar feeds")).toBeInTheDocument();
  expect(screen.queryByText("Discord Companion")).not.toBeInTheDocument();
});

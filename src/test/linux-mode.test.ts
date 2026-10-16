import { describe, expect, it } from "vitest";
import { extractCommands, extractNotes, findTerminalError, isRiskyCommand, stripAnsi } from "@/lib/linux";
import { characterModeCommand } from "@/lib/hellraiser";
import { agentName } from "@/lib/agents";

describe("Linux Mode", () => {
  it("switches on and off by chat command", () => {
    expect(characterModeCommand("Linux Mode")).toBe("linux");
    expect(characterModeCommand("linux mode off")).toBe("normal");
  });
  it("Claude becomes Tux, the terminal pal", () => {
    expect(agentName("claude", false, false, "linux")).toBe("Tux");
  });
  it("flags sudo and recursive deletes as risky", () => {
    expect(isRiskyCommand("sudo pacman -Syu")).toBe(true);
    expect(isRiskyCommand("rm -rf ~/build")).toBe(true);
    expect(isRiskyCommand("ls -la")).toBe(false);
  });
  it("extracts commands from bash blocks without prompts or comments", () => {
    expect(extractCommands("Try:\n```bash\n# restart\n$ systemctl --user restart pipewire\n```")).toEqual(["systemctl --user restart pipewire"]);
  });
  it("extracts proposed notes", () => {
    expect(extractNotes("```note groceries.md\nmilk\n```")).toEqual([{ name: "groceries.md", content: "milk\n" }]);
  });
  it("spots terminal errors", () => {
    expect(findTerminalError(stripAnsi("\x1b[31mfish: Unknown command: foo\x1b[0m\n> "))).toContain("Unknown command");
    expect(findTerminalError("all good\n")).toBeNull();
  });
});

describe("assistant mode", () => {
  it("is a switch typed on/off, separate from the theme", async () => {
    const { assistantCommand, characterModeCommand } = await import("@/lib/hellraiser");
    expect(assistantCommand("Assistant Mode")).toBe(true);
    expect(assistantCommand("assistant mode off")).toBe(false);
    expect(characterModeCommand("Linux Mode")).toBe("linux");
  });
  it("keeps the theme's character but gives them the assistant job", async () => {
    const { agentPersona } = await import("@/lib/agents");
    const sage = agentPersona("sage", false, false, "matrix", true);
    expect(sage.name).toBe("Morpheus");
    expect(sage.role).toBe("Calendar Assistant");
    expect(agentPersona("sage", false, false, "matrix", false).role).toBe("The mentor");
  });
  it("Dungeon Crawler Carl theme casts Katia in Echo's seat", async () => {
    const { agentName, resolveMention } = await import("@/lib/agents");
    expect(agentName("echo", false, false, "dcc")).toBe("Katia");
    expect(agentName("nova", false, false, "dcc")).toBe("Carl");
    expect(resolveMention("@donut hi", "dcc")).toBe("byte");
  });
});

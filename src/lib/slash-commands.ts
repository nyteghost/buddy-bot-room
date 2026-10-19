import type { Mode } from "./agents";
import type { CharacterMode } from "./hellraiser";

/** Room controls you can type instead of click. Pure parsing only — the Room runs the action. */
export type ThemeId = Exclude<CharacterMode, "assistant">;
export type SlashAction =
  | { type: "help" }
  | { type: "clear" }
  | { type: "stop" }
  | { type: "export" }
  | { type: "record" }
  | { type: "confetti" }
  | { type: "mode"; mode: Mode }
  | { type: "rounds"; rounds: number }
  | { type: "theme"; theme: ThemeId }
  | { type: "assistant"; on: boolean };
export type SlashResult = { ok: true; action: SlashAction } | { ok: false; error: string };

export const MIN_ROUNDS = 1;
export const MAX_ROUNDS = 5;

const MODES: Record<string, Mode> = {
  roundtable: "roundtable",
  table: "roundtable",
  broadcast: "broadcast",
  direct: "direct",
  "one-on-one": "direct",
  oneonone: "direct",
  solve: "solve",
  problem: "solve",
  "problem-solving": "solve",
  problemsolving: "solve",
};
const THEMES: Record<string, ThemeId> = {
  normal: "normal", default: "normal",
  hellraiser: "hellraiser", hell: "hellraiser",
  horror: "horror",
  matrix: "matrix",
  finalfantasy: "finalfantasy", ff: "finalfantasy",
  devteam: "devteam", dev: "devteam",
  cyberpunk: "cyberpunk", cyber: "cyberpunk",
  dcc: "dcc", carl: "dcc",
  linux: "linux",
};
const modeNames = ["roundtable", "broadcast", "direct", "solve"];
const themeNames = ["normal", "hellraiser", "horror", "matrix", "finalfantasy", "devteam", "cyberpunk", "dcc", "linux"];

export const slashCommands = [
  { name: "help", usage: "/help", description: "List every command" },
  { name: "mode", usage: "/mode <roundtable|broadcast|direct|solve>", description: "Switch conversation mode" },
  { name: "rounds", usage: `/rounds <${MIN_ROUNDS}-${MAX_ROUNDS}>`, description: "How many rounds the pals debate" },
  { name: "theme", usage: "/theme <name>", description: "Swap the whole cast" },
  { name: "assistant", usage: "/assistant [on|off]", description: "Turn Assistant Mode on or off" },
  { name: "clear", usage: "/clear", description: "Start a fresh conversation" },
  { name: "stop", usage: "/stop", description: "Stop the current discussion" },
  { name: "export", usage: "/export", description: "Download this chat as Markdown" },
  { name: "record", usage: "/record", description: "Open the recorder" },
  { name: "confetti", usage: "/confetti", description: "Celebrate something" },
] as const;

const slug = (s: string) => s.toLowerCase().replace(/[\s_-]+/g, "");

/** Returns null when the text isn't a slash command at all (including paths like /etc/fstab). */
export function parseSlash(input: string): SlashResult | null {
  const text = input.trim();
  const match = text.match(/^\/([^\s]*)\s*([\s\S]*)$/);
  if (!match) return null;
  const name = match[1].toLowerCase();
  const arg = match[2].trim().toLowerCase();
  if (!name || /[/.]/.test(name)) return null;
  const fail = (error: string): SlashResult => ({ ok: false, error });
  switch (name) {
    case "help": case "commands": case "?":
      return { ok: true, action: { type: "help" } };
    case "clear": case "new":
      return { ok: true, action: { type: "clear" } };
    case "stop":
      return { ok: true, action: { type: "stop" } };
    case "export":
      return { ok: true, action: { type: "export" } };
    case "record": case "mic":
      return { ok: true, action: { type: "record" } };
    case "confetti": case "party":
      return { ok: true, action: { type: "confetti" } };
    case "mode": {
      const mode = MODES[arg] ?? MODES[slug(arg)];
      return mode ? { ok: true, action: { type: "mode", mode } } : fail(`Pick a mode: ${modeNames.join(", ")}.`);
    }
    case "rounds": {
      const n = Number(arg);
      return arg !== "" && Number.isInteger(n) && n >= MIN_ROUNDS && n <= MAX_ROUNDS
        ? { ok: true, action: { type: "rounds", rounds: n } }
        : fail(`Rounds must be a number from ${MIN_ROUNDS} to ${MAX_ROUNDS}.`);
    }
    case "theme": {
      const theme = THEMES[slug(arg)];
      return theme ? { ok: true, action: { type: "theme", theme } } : fail(`Pick a theme: ${themeNames.join(", ")}.`);
    }
    case "assistant": {
      if (arg === "" || arg === "on") return { ok: true, action: { type: "assistant", on: true } };
      if (arg === "off") return { ok: true, action: { type: "assistant", on: false } };
      return fail("Use /assistant on or /assistant off.");
    }
    default:
      return fail(`Unknown command /${name}. Type /help to see what's available.`);
  }
}

export type SlashSuggestion = { label: string; insert: string; description: string };

/** Autocomplete entries for what's typed so far; empty unless the text starts with "/". */
export function slashSuggestions(input: string): SlashSuggestion[] {
  if (!input.startsWith("/")) return [];
  const body = input.slice(1);
  const space = body.search(/\s/);
  if (space === -1) {
    const typed = body.toLowerCase();
    return slashCommands
      .filter((c) => c.name.startsWith(typed))
      .map((c) => ({ label: c.usage, insert: `/${c.name} `, description: c.description }));
  }
  const name = body.slice(0, space).toLowerCase();
  const typedArg = body.slice(space).trim().toLowerCase();
  const choices = name === "mode" ? modeNames : name === "theme" ? themeNames : name === "assistant" ? ["on", "off"] : [];
  return choices
    .filter((c) => c.startsWith(typedArg) && c !== typedArg)
    .map((c) => ({ label: c, insert: `/${name} ${c}`, description: "" }));
}

export function helpText(): string {
  return [
    "Slash commands:",
    ...slashCommands.map((c) => `• \`${c.usage}\` — ${c.description}`),
    "",
    "Tips: press ↑ in an empty box to bring back your last message, and Tab to finish a command.",
  ].join("\n");
}

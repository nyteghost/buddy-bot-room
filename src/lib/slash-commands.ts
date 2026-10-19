import type { Mode } from "./agents";
import type { CharacterMode } from "./hellraiser";
import { parseDice } from "./dice";

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
  | { type: "assistant"; on: boolean }
  | { type: "remember"; text: string }
  | { type: "forget"; target: number | "all" }
  | { type: "memories" }
  | { type: "note"; text: string }
  | { type: "todo"; text: string }
  | { type: "done"; n: number }
  | { type: "clearDone" }
  | { type: "tasks" }
  | { type: "search"; query: string }
  | { type: "research"; query: string }
  | { type: "compare"; question: string }
  | { type: "log" }
  | { type: "library"; query: string }
  | { type: "roll"; expr: string }
  | { type: "plex"; query: string }
  | { type: "watch"; mood: string }
  | { type: "trakt"; list: string }
  | { type: "request"; title: string }
  | { type: "backup"; now: boolean }
  | { type: "brief"; send: boolean }
  | { type: "voice"; mode: "on" | "off" | "toggle" }
  | { type: "next"; list: string; mood: string }
  | { type: "server" }
  | { type: "diagnose" }
  | { type: "dm"; sub: "start" | "end" | "status" | "character" | "fact" | "unfact"; text: string; n?: number };
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
export const modeNames = ["roundtable", "broadcast", "direct", "solve"];
export const themeNames = ["normal", "hellraiser", "horror", "matrix", "finalfantasy", "devteam", "cyberpunk", "dcc", "linux"];

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
  { name: "remember", usage: "/remember <fact>", description: "Pals will remember this in every chat" },
  { name: "memories", usage: "/memories", description: "Show what the pals remember" },
  { name: "forget", usage: "/forget <number|all>", description: "Remove a memory" },
  { name: "note", usage: "/note <text>", description: "Save a quick note" },
  { name: "todo", usage: "/todo <task>", description: "Add a to-do (or /todo clear)" },
  { name: "done", usage: "/done <number>", description: "Tick a to-do off" },
  { name: "tasks", usage: "/tasks", description: "Open notes, memories and to-dos" },
  { name: "search", usage: "/search <query>", description: "Search the web (needs SearXNG)" },
  { name: "research", usage: "/research <question>", description: "Search, then let the pals discuss the results" },
  { name: "watch", usage: "/watch [mood]", description: "What should we watch tonight? The pals pick from your Plex library" },
  { name: "next", usage: "/next [list:name] [mood]", description: "What should we watch next? The pals pick from your Trakt list (needs TRAKT_CLIENT_ID)" },
  { name: "voice", usage: "/voice [on|off]", description: "Read replies aloud (your browser's own voices)" },
  { name: "brief", usage: "/brief [send]", description: "Today's morning brief (add send to push it to your phone)" },
  { name: "backup", usage: "/backup [now]", description: "Show the nightly backup status, or back up now (owner)" },
  { name: "request", usage: "/request <title> [4k]", description: "Request a title through Seerr (same as @seerr)" },
  { name: "trakt", usage: "/trakt [lists|<list>]", description: "Show your Trakt lists, or the items in one" },
  { name: "plex", usage: "/plex <title|recent>", description: "Look in your Plex library (needs PLEX_URL)" },
  { name: "server", usage: "/server", description: "Check your Unraid server now" },
  { name: "diagnose", usage: "/diagnose", description: "What's wrong with my server? The pals look at Unraid and advise" },
  { name: "dm", usage: "/dm start <premise>", description: "Dungeon Master mode: start, end, status, character, fact" },
  { name: "roll", usage: "/roll <2d6+3|d20 adv>", description: "Roll dice" },
  { name: "library", usage: "/library <title|recent>", description: "Look in your Jellyfin library (needs JELLYFIN_URL)" },
  { name: "log", usage: "/log", description: "Open the debug log to copy for a bug report" },
  { name: "compare", usage: "/compare <question>", description: "Blind side-by-side model test" },
] as const;

const slug = (s: string) => s.toLowerCase().replace(/[\s_-]+/g, "");

/** Returns null when the text isn't a slash command at all (including paths like /etc/fstab). */
export function parseSlash(input: string): SlashResult | null {
  const text = input.trim();
  const match = text.match(/^\/([^\s]*)\s*([\s\S]*)$/);
  if (!match) return null;
  const name = (match[1] ?? "").toLowerCase();
  const rawArg = (match[2] ?? "").trim();
  const arg = rawArg.toLowerCase();
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
    case "remember": case "mem":
      return rawArg ? { ok: true, action: { type: "remember", text: rawArg } } : fail("Tell me what to remember: /remember I run Unraid.");
    case "memories": case "memory":
      return { ok: true, action: { type: "memories" } };
    case "forget": {
      if (arg === "all") return { ok: true, action: { type: "forget", target: "all" } };
      const n = Number(arg);
      return arg !== "" && Number.isInteger(n) && n >= 1
        ? { ok: true, action: { type: "forget", target: n } }
        : fail("Use /forget <number> (see /memories) or /forget all.");
    }
    case "note":
      return rawArg ? { ok: true, action: { type: "note", text: rawArg } } : fail("Write the note after the command: /note call the venue.");
    case "todo": case "task": {
      if (arg === "clear") return { ok: true, action: { type: "clearDone" } };
      return rawArg ? { ok: true, action: { type: "todo", text: rawArg } } : fail("Add the task after the command: /todo order cable.");
    }
    case "done": {
      const n = Number(arg);
      return arg !== "" && Number.isInteger(n) && n >= 1
        ? { ok: true, action: { type: "done", n } }
        : fail("Use /done <number> — the number shown next to the to-do.");
    }
    case "tasks": case "notes": case "todos":
      return { ok: true, action: { type: "tasks" } };
    case "search":
      return rawArg ? { ok: true, action: { type: "search", query: rawArg } } : fail("What should I search for? /search best 4k projector");
    case "research":
      return rawArg ? { ok: true, action: { type: "research", query: rawArg } } : fail("What should the pals research? /research is a 4090 worth it");
    case "plex":
      return { ok: true, action: { type: "plex", query: rawArg || "recent" } };
    case "voice": case "speak":
      return { ok: true, action: { type: "voice", mode: arg === "on" ? "on" : arg === "off" ? "off" : "toggle" } };
    case "brief": case "morning":
      return { ok: true, action: { type: "brief", send: arg === "send" } };
    case "backup":
      return { ok: true, action: { type: "backup", now: arg === "now" } };
    case "request":
      return rawArg ? { ok: true, action: { type: "request", title: rawArg } } : fail("Which title? /request Dune Part Two");
    case "trakt":
      return { ok: true, action: { type: "trakt", list: rawArg } };
    case "next": {
      const m = /^list:(\S+)\s*(.*)$/i.exec(rawArg);
      return { ok: true, action: { type: "next", list: m?.[1] ?? "", mood: (m ? m[2] : rawArg) ?? "" } };
    }
    case "watch": case "tonight":
      return { ok: true, action: { type: "watch", mood: rawArg } };
    case "server": case "unraid":
      return { ok: true, action: { type: "server" } };
    case "diagnose": case "whatswrong":
      return { ok: true, action: { type: "diagnose" } };
    case "roll": case "r": case "dice": {
      const expr = rawArg || "d20";
      const d = parseDice(expr);
      return d.ok ? { ok: true, action: { type: "roll", expr } } : fail(d.error);
    }
    case "dm": case "campaign": {
      const [sub = "", ...rest] = rawArg.split(/\s+/);
      const text = rest.join(" ").trim();
      const s = sub.toLowerCase();
      if (s === "start" || s === "new" || s === "begin")
        return text ? { ok: true, action: { type: "dm", sub: "start", text } } : fail("Give the adventure a premise: /dm start a haunted lighthouse on a stormy coast.");
      if (s === "end" || s === "stop" || s === "pause") return { ok: true, action: { type: "dm", sub: "end", text: "" } };
      if (s === "status" || s === "") return { ok: true, action: { type: "dm", sub: "status", text: "" } };
      if (s === "character" || s === "char" || s === "hero")
        return text ? { ok: true, action: { type: "dm", sub: "character", text } } : fail("Describe your character: /dm character a nervous halfling locksmith.");
      if (s === "fact" || s === "lore" || s === "note")
        return text ? { ok: true, action: { type: "dm", sub: "fact", text } } : fail("Tell me the fact: /dm fact the lighthouse keeper vanished three nights ago.");
      if (s === "unfact" || s === "forget") {
        const n = Number(text);
        return Number.isInteger(n) && n >= 1 ? { ok: true, action: { type: "dm", sub: "unfact", text: "", n } } : fail("Use /dm forget <number> (see /dm status).");
      }
      return fail("Use /dm start <premise>, /dm end, /dm status, /dm character <text>, /dm fact <text> or /dm forget <number>.");
    }
    case "library": case "lib": case "jellyfin":
      return { ok: true, action: { type: "library", query: rawArg || "recent" } };
    case "log": case "debug":
      return { ok: true, action: { type: "log" } };
    case "compare":
      return { ok: true, action: { type: "compare", question: rawArg } };
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

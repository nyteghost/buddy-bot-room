import { resolveMention, type AgentId, type Mode } from "./agents";
import type { CharacterMode } from "./hellraiser";
import { parseDice } from "./dice";
import { parsePromptArgs } from "./prompts";
import { parseWrite } from "./trakt-write";
import { parseWindowSeconds } from "./debug-log";

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
  | { type: "remember"; text: string; pal?: AgentId }
  | { type: "forget"; target: number | "all"; pal?: AgentId }
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
  | { type: "logfile"; seconds: number }
  | { type: "library"; query: string }
  | { type: "roll"; expr: string }
  | { type: "plex"; query: string }
  | { type: "watch"; mood: string }
  | { type: "trakt"; list: string }
  | { type: "trakt-write"; op: string; text: string }
  | { type: "request"; title: string }
  | { type: "backup"; now: boolean; op?: "list" | "restore"; name?: string; confirm?: boolean }
  | { type: "brief"; send: boolean }
  | { type: "review"; send: boolean }
  | { type: "update" }
  | { type: "prompt"; op: "list" | "save" | "remove" | "use"; name: string; text: string }
  | { type: "voice"; mode: "on" | "off" | "toggle" }
  | { type: "focus"; mode: "on" | "off" | "toggle" }
  | { type: "status" }
  | { type: "weather" }
  | { type: "remind"; op: "list" | "add" | "remove" | "snooze"; text: string }
  | { type: "event"; text: string }
  | { type: "panel"; panel: "calendar" | "mail" | "today" | "tasks" | "setup" | "search" }
  | { type: "hide"; mode: "on" | "off" | "toggle" }
  | { type: "appearance"; words: string }
  | { type: "lowpower"; on: boolean | null }
  | { type: "m365"; op: string }
  | { type: "schedule"; op: "list" | "add" | "remove" | "run"; text: string }
  | { type: "web"; mode: "on" | "off" | "toggle" }
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
  debate: "debate",
  smart: "smart",
  team: "smart",
  "smart-team": "smart",
  smartteam: "smart",
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
export const modeNames = ["roundtable", "broadcast", "direct", "solve", "debate", "smart"];
export const themeNames = ["normal", "hellraiser", "horror", "matrix", "finalfantasy", "devteam", "cyberpunk", "dcc", "linux"];

export const slashCommands = [
  { name: "help", usage: "/help", description: "List every command" },
  { name: "mode", usage: "/mode <roundtable|broadcast|direct|solve|debate|smart>", description: "Switch conversation mode" },
  { name: "rounds", usage: `/rounds <${MIN_ROUNDS}-${MAX_ROUNDS}>`, description: "How many rounds the pals debate" },
  { name: "theme", usage: "/theme <name>", description: "Swap the whole cast" },
  { name: "assistant", usage: "/assistant [on|off]", description: "Office look on or off (same as /theme linux)" },
  { name: "clear", usage: "/clear", description: "Start a fresh conversation" },
  { name: "stop", usage: "/stop", description: "Stop the current discussion" },
  { name: "export", usage: "/export", description: "Download this chat as Markdown" },
  { name: "record", usage: "/record", description: "Open the recorder" },
  { name: "confetti", usage: "/confetti", description: "Celebrate something" },
  { name: "remember", usage: "/remember <fact>", description: "Pals will remember this in every chat (add @name to tell only one pal)" },
  { name: "memories", usage: "/memories", description: "Show what the pals remember" },
  { name: "forget", usage: "/forget [@pal] <number|all>", description: "Remove a memory" },
  { name: "note", usage: "/note <text>", description: "Save a quick note" },
  { name: "todo", usage: "/todo <task>", description: "Add a to-do (or /todo clear)" },
  { name: "done", usage: "/done <number>", description: "Tick a to-do off" },
  { name: "tasks", usage: "/tasks", description: "Open notes and memories" },
  { name: "search", usage: "/search <query>", description: "Search the web (needs SearXNG)" },
  { name: "research", usage: "/research <question>", description: "Search, then let the pals discuss the results" },
  { name: "watch", usage: "/watch [mood]", description: "What should we watch tonight? The pals pick from your Plex library" },
  { name: "next", usage: "/next [list:name] [mood]", description: "What should we watch next? The pals pick from your Trakt list (needs TRAKT_CLIENT_ID)" },
  { name: "schedule", usage: "/schedule add 08:00 weekdays <question> | list | remove N | run N", description: "Have the pals answer something on a schedule and send it to your phone (owner only; free keys and Local AI only)" },
  { name: "m365", usage: "/m365 connect | status | today | mail | summary | disconnect", description: "Read-only work calendar and unread mail subjects (Microsoft 365). Summaries use Local AI only" },
  { name: "appearance", usage: "/appearance light|dark|auto · small|normal|large", description: "Colour scheme (light applies to the Normal theme) and text size" },
  { name: "lowpower", usage: "/lowpower on|off", description: "Low-power mode: slower background timers, decorative animations paused, less frequent polling (good for phones and battery)" },
  { name: "calendar", usage: "/calendar", description: "Open the Calendar window (next 7 days)" },
  { name: "mail", usage: "/mail", description: "Open the Mail window (unread subjects)" },
  { name: "find", usage: "/find", description: "Search your saved chats, notes, tasks, memories and reminders" },
  { name: "setup", usage: "/setup", description: "Open Settings: connect things and test each connection (owner only)" },
  { name: "hide", usage: "/hide [on|off]", description: "Blur links and addresses on this device so screenshots are safe" },
  { name: "today", usage: "/today", description: "Weather, calendar, unread mail, tasks and a watch pick in one window" },
  { name: "remind", usage: "/remind in 30m call mom | every monday 9am send report | list | snooze N 30m | remove N", description: "One-time reminder pushed to your phone (owner only; needs NTFY_URL or Telegram)" },
  { name: "event", usage: "/event friday 3pm dentist [for 1h]", description: "Make a calendar event: download an .ics file or add it to Google or Outlook" },
  { name: "weather", usage: "/weather", description: "Current weather and the next few days (set WEATHER_LOCATION on the server)" },
  { name: "status", usage: "/status", description: "Check that Local AI, search, Plex, Seerr, Jellyfin, Unraid and backups are all working" },
  { name: "web", usage: "/web [on|off]", description: "Let the pals search the web on their own when a question needs current facts" },
  { name: "focus", usage: "/focus [on|off]", description: "Calm, chat-only view with nothing else on screen" },
  { name: "voice", usage: "/voice [on|off]", description: "Read replies aloud (your browser's own voices)" },
  { name: "prompt", usage: "/prompt [name] | save <name> = <text> | remove <name>", description: "Saved prompts: fill the message box with a ready-made starting point" },
  { name: "update", usage: "/update", description: "Check whether a newer version is available and how to install it (owner only)" },
  { name: "review", usage: "/review [send]", description: "Your week ahead: calendar, reminders, mail and picks (owner only)" },
  { name: "brief", usage: "/brief [send]", description: "Today's morning brief (add send to push it to your phone)" },
  { name: "backup", usage: "/backup [now | list | restore N]", description: "Backup status, back up now, list backups or restore one (owner)" },
  { name: "request", usage: "/request <title> [4k]", description: "Request a title through Seerr (same as @seerr)" },
  { name: "trakt", usage: "/trakt [lists|<list>|connect|status|add <title>|watched <title>|remove <title>]", description: "Show your Trakt lists, or add/mark titles once connected" },
  { name: "plex", usage: "/plex <title|recent>", description: "Look in your Plex library (needs PLEX_URL)" },
  { name: "server", usage: "/server", description: "Check your Unraid server now" },
  { name: "diagnose", usage: "/diagnose", description: "What's wrong with my server? The pals look at Unraid and advise" },
  { name: "dm", usage: "/dm start <premise>", description: "Dungeon Master mode: start, end, status, character, fact" },
  { name: "roll", usage: "/roll <2d6+3|d20 adv>", description: "Roll dice" },
  { name: "library", usage: "/library <title|recent>", description: "Look in your Jellyfin library (needs JELLYFIN_URL)" },
  { name: "@log", usage: "@log [10s|2m]", description: "Download the browser and server log lines from the last 10 seconds (or the time you give)" },
  { name: "log", usage: "/log", description: "Open the debug log to copy for a bug report" },
  { name: "compare", usage: "/compare <question>", description: "Blind side-by-side model test" },
] as const;

const slug = (s: string) => s.toLowerCase().replace(/[\s_-]+/g, "");

/** Returns null when the text isn't a slash command at all (including paths like /etc/fstab). */
export function parseSlash(input: string): SlashResult | null {
  const text = input.trim();
  const logFile = text.match(/^@log\b\s*([\s\S]*)$/i);
  if (logFile) {
    const seconds = parseWindowSeconds(logFile[1] ?? "");
    return seconds ? { ok: true, action: { type: "logfile", seconds } } : { ok: false, error: "Type @log for the last 10 seconds, or @log 60 / @log 2m for longer (up to 60 minutes)." };
  }
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
    case "remember": case "mem": {
      const pal = /^@/.test(rawArg) ? resolveMention(rawArg) : null;
      if (pal) {
        const text = rawArg.replace(/^@[\w&-]+\s*/, "").trim();
        return text ? { ok: true, action: { type: "remember", text, pal } } : fail("What should that pal remember? /remember @byte I use Arch.");
      }
      return rawArg ? { ok: true, action: { type: "remember", text: rawArg } } : fail("Tell me what to remember: /remember I run Unraid. Add @name to tell only one pal: /remember @byte I use Arch.");
    }
    case "memories": case "memory":
      return { ok: true, action: { type: "memories" } };
    case "forget": {
      const pal = /^@/.test(rawArg) ? resolveMention(rawArg) : null;
      const which = pal ? rawArg.replace(/^@[\w&-]+\s*/, "").trim().toLowerCase() : arg;
      const withPal = <T extends object>(a: T) => (pal ? { ...a, pal } : a);
      if (which === "all") return { ok: true, action: withPal({ type: "forget" as const, target: "all" as const }) };
      const n = Number(which);
      return which !== "" && Number.isInteger(n) && n >= 1
        ? { ok: true, action: withPal({ type: "forget" as const, target: n }) }
        : fail("Use /forget <number> (see /memories) or /forget all. For one pal: /forget @byte 2.");
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
    case "schedule": case "schedules": case "cron": {
      const m = /^\s*(add|list|remove|rm|run)?\s*([\s\S]*)$/i.exec(rawArg);
      const op = (m?.[1] ?? "list").toLowerCase();
      const text = (m?.[2] ?? "").trim();
      if (op === "add" && !text) return fail("Use: /schedule add 08:00 weekdays what should I know today?");
      if ((op === "remove" || op === "rm" || op === "run") && !text) return fail(`Which one? /schedule ${op} 1`);
      return { ok: true, action: { type: "schedule", op: op === "rm" ? "remove" : (op as "list" | "add" | "remove" | "run"), text } };
    }
    case "m365": case "work365": case "outlook":
      return { ok: true, action: { type: "m365", op: arg } };
    case "appearance": case "theme-color": case "textsize":
      return rawArg ? { ok: true, action: { type: "appearance", words: rawArg } } : fail("Try /appearance light, /appearance dark, /appearance auto, or /appearance large.");
    case "lowpower": case "low-power": case "battery":
      if (arg && !["on", "off", "toggle"].includes(arg)) return fail("Try /lowpower on or /lowpower off.");
      return { ok: true, action: { type: "lowpower", on: arg === "on" ? true : arg === "off" ? false : null } };
    case "calendar": case "agenda":
      return { ok: true, action: { type: "panel", panel: "calendar" } };
    case "find": case "lookup":
      return { ok: true, action: { type: "panel", panel: "search" } };
    case "setup": case "connections":
      return { ok: true, action: { type: "panel", panel: "setup" } };
    case "hide": case "privacy":
      return { ok: true, action: { type: "hide", mode: arg === "on" ? "on" : arg === "off" ? "off" : "toggle" } };
    case "today": case "day":
      return { ok: true, action: { type: "panel", panel: "today" } };
    case "mail": case "inbox":
      return { ok: true, action: { type: "panel", panel: "mail" } };
    case "remind": case "reminder": case "reminders": {
      const first = (rawArg.split(/\s+/)[0] ?? "").toLowerCase();
      if (!rawArg || first === "list") return { ok: true, action: { type: "remind", op: "list", text: "" } };
      if (first === "snooze") {
        const rest = rawArg.split(/\s+/).slice(1);
        return rest.length ? { ok: true, action: { type: "remind", op: "snooze", text: rest.join(" ") } } : fail("Use: /remind snooze 1 30m (the reminder number, then how long)");
      }
      if (first === "remove" || first === "rm" || first === "delete") {
        const which = rawArg.split(/\s+/)[1] ?? "";
        return which ? { ok: true, action: { type: "remind", op: "remove", text: which } } : fail("Which one? /remind remove 1");
      }
      return { ok: true, action: { type: "remind", op: "add", text: rawArg } };
    }
    case "event": case "cal":
      return rawArg ? { ok: true, action: { type: "event", text: rawArg } } : fail("Use: /event friday 3pm dentist, or /event tomorrow 10:30 lunch with Sam for 90m");
    case "weather": case "forecast":
      return { ok: true, action: { type: "weather" } };
    case "status": case "health":
      return { ok: true, action: { type: "status" } };
    case "web": case "autosearch":
      return { ok: true, action: { type: "web", mode: arg === "on" ? "on" : arg === "off" ? "off" : "toggle" } };
    case "focus": case "calm":
      return { ok: true, action: { type: "focus", mode: arg === "on" ? "on" : arg === "off" ? "off" : "toggle" } };
    case "voice": case "speak":
      return { ok: true, action: { type: "voice", mode: arg === "on" ? "on" : arg === "off" ? "off" : "toggle" } };
    case "prompt": case "prompts": case "template": {
      const p = parsePromptArgs(rawArg);
      return "error" in p ? fail(p.error) : { ok: true, action: { type: "prompt", ...p } };
    }
    case "update": case "updates": case "version":
      return { ok: true, action: { type: "update" } };
    case "review": case "week": case "weekly":
      return { ok: true, action: { type: "review", send: arg === "send" } };
    case "brief": case "morning":
      return { ok: true, action: { type: "brief", send: arg === "send" } };
    case "backup": {
      const [sub = "", ...more] = rawArg.split(/\s+/);
      if (sub.toLowerCase() === "list") return { ok: true, action: { type: "backup", now: false, op: "list" } };
      if (sub.toLowerCase() === "restore") {
        const confirm = more[more.length - 1]?.toLowerCase() === "confirm";
        const name = (confirm ? more.slice(0, -1) : more).join(" ");
        return { ok: true, action: { type: "backup", now: false, op: "restore", name, confirm } };
      }
      return { ok: true, action: { type: "backup", now: arg === "now" } };
    }
    case "request":
      return rawArg ? { ok: true, action: { type: "request", title: rawArg } } : fail("Which title? /request Dune Part Two");
    case "trakt": {
      const w = parseWrite(rawArg);
      if (w) return { ok: true, action: { type: "trakt-write", op: w.op, text: w.text } };
      return { ok: true, action: { type: "trakt", list: rawArg } };
    }
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
      .filter((c) => !c.name.startsWith("@") && c.name.startsWith(typed))
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

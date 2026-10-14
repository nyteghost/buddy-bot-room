/** Linux Mode helpers: browser-safe, with desktop (Tauri) calls loaded lazily. */
import type { AgentId } from "./agents";
import { isTauri } from "./local-llm";

const RISKY = [
  /\bsudo\b/,
  /\brm\s+(-[a-z]*[rf][a-z]*\s+)+/i,
  /\bdd\b/,
  /\bmkfs/,
  /\bpacman\s+-R/,
  /\bchmod\s+-R\b/,
  /\bchown\s+-R\b/,
  /\b(shutdown|reboot|poweroff)\b/,
  />\s*\/dev\/sd/,
  /:\(\)\s*\{/,
  /curl[^|]*\|\s*(ba|z|fi)?sh/,
];
/** True for commands that can change the system or delete data — these need a second confirm. */
export function isRiskyCommand(cmd: string): boolean {
  return RISKY.some((r) => r.test(cmd));
}

/** Pulls runnable shell commands out of ```bash / ```sh / ```fish / ```shell blocks. */
export function extractCommands(text: string): string[] {
  const out: string[] = [];
  for (const m of text.matchAll(/```(?:bash|sh|shell|fish|zsh|console)?\n([\s\S]*?)```/g)) {
    const body = (m[1] ?? "").trim();
    if (!body) continue;
    const lines = body.split("\n").map((l) => l.replace(/^\$\s+/, "").trim()).filter((l) => l && !l.startsWith("#"));
    if (lines.length) out.push(lines.join("\n"));
  }
  return out;
}

/** ```note filename.md ... ``` blocks the Notes pal proposes to save. */
export function extractNotes(text: string): { name: string; content: string }[] {
  return [...text.matchAll(/```note\s+([^\n/]+)\n([\s\S]*?)```/g)].map((m) => ({
    name: (m[1] ?? "").trim(),
    content: (m[2] ?? "").trimEnd() + "\n",
  }));
}

const ANSI = /\x1b\[[0-9;?]*[ -/]*[@-~]|\x1b\][^\x07]*(\x07|\x1b\\)|\r/g;
export function stripAnsi(text: string) {
  return text.replace(ANSI, "");
}
const ERROR_LINE = /(error|not found|permission denied|failed|no such file|cannot|fatal|segmentation fault|traceback|unknown command|could not)/i;
/** Returns the most recent error-looking line in terminal output, if any. */
export function findTerminalError(plain: string): string | null {
  const lines = plain.split("\n").slice(-30).reverse();
  return lines.find((l) => ERROR_LINE.test(l))?.trim() ?? null;
}

// ---------- Settings ----------
const notesKey = "pixel-pals-notes-dir-v1";
export function notesDir() {
  try {
    return localStorage.getItem(notesKey) || "~/Notes";
  } catch {
    return "~/Notes";
  }
}
export function setNotesDir(dir: string) {
  try {
    localStorage.setItem(notesKey, dir.trim() || "~/Notes");
  } catch {
    /* storage unavailable */
  }
}

// ---------- Desktop bridge ----------
async function invoke<T>(cmd: string, args?: Record<string, unknown>) {
  const { invoke } = await import("@tauri-apps/api/core");
  return invoke<T>(cmd, args);
}
export const desktop = {
  ptySpawn: (cols: number, rows: number) => invoke<void>("pty_spawn", { cols, rows }),
  ptyWrite: (data: string) => invoke<void>("pty_write", { data }),
  ptyResize: (cols: number, rows: number) => invoke<void>("pty_resize", { cols, rows }),
  systemStats: () => invoke<string>("system_stats"),
  listDir: (path: string) => invoke<string[]>("list_dir", { path }),
  readText: (path: string) => invoke<string>("read_text", { path }),
  writeNote: (dir: string, name: string, content: string) => invoke<string>("write_note", { dir, name, content }),
  appInfo: () => invoke<{ sha: string; dir: string }>("app_info"),
  checkUpdate: (repo: string) => invoke<{ sha: string; message: string }>("check_update", { repo }),
  runUpdate: () => invoke<void>("run_update"),
};
export async function onPty(event: "pty-output" | "pty-exit", cb: (data: string) => void) {
  const { listen } = await import("@tauri-apps/api/event");
  return listen<string>(event, (e) => cb(typeof e.payload === "string" ? e.payload : ""));
}

// Recent terminal output (plain text) so the Terminal pal can read it.
let terminalTail = "";
export function recordTerminal(plain: string) {
  terminalTail = (terminalTail + plain).slice(-6000);
}
export function recentTerminal(lines = 80) {
  return terminalTail.split("\n").slice(-lines).join("\n");
}

/** Live data from this computer for a Linux Mode pal (desktop only). Empty in the browser. */
export async function linuxContext(id: AgentId): Promise<string> {
  if (!isTauri()) return "";
  try {
    if (id === "rune") return `System stats right now:\n${await desktop.systemStats()}`;
    if (id === "claude") return `Last lines of the user's terminal:\n${recentTerminal() || "(terminal empty)"}`;
    if (id === "pip") {
      const dir = notesDir();
      const files = await desktop.listDir(dir).catch(() => [] as string[]);
      const notes = files.filter((f) => /\.(md|txt)$/i.test(f)).slice(0, 5);
      const bodies = await Promise.all(
        notes.map(async (f) => `--- ${f}\n${(await desktop.readText(`${dir}/${f}`).catch(() => "")).slice(0, 600)}`),
      );
      return `Notes folder ${dir} contains: ${files.join(", ") || "(empty)"}\n${bodies.join("\n")}`;
    }
    if (id === "echo") {
      const files = await desktop.listDir("~/Downloads").catch(() => [] as string[]);
      return `~/Downloads contains ${files.length} items: ${files.slice(0, 120).join(", ")}`;
    }
  } catch {
    /* desktop helper failed; continue without context */
  }
  return "";
}

/** Asks one pal a question from anywhere in the app (e.g. the terminal). */
export function askPal(partner: AgentId, text: string) {
  window.dispatchEvent(new CustomEvent("pixelpals:ask", { detail: { partner, text } }));
}
/** Sends an approved command to the in-app terminal. */
export function runInTerminal(cmd: string) {
  window.dispatchEvent(new CustomEvent("pixelpals:run", { detail: cmd }));
}

import { describeError, redact } from "./redact";

/** In-memory ring buffer of server events (also echoed to the console, so Portainer's container logs have them). */
type Entry = { t: string; level: "info" | "warn" | "error"; msg: string };
const MAX = 300;
// Stored on globalThis so the Vite plugin and the app's server modules (separate module graphs) share one buffer.
const store = globalThis as unknown as { __buddyLog?: Entry[] };
const entries: Entry[] = (store.__buddyLog ??= []);

export function logServer(level: Entry["level"], msg: string, error?: unknown): void {
  const text = redact(error === undefined ? msg : `${msg} — ${describeError(error)}`);
  entries.push({ t: new Date().toISOString(), level, msg: text.slice(0, 3000) });
  if (entries.length > MAX) entries.splice(0, entries.length - MAX);
  const line = `[buddy ${level}] ${text}`;
  if (level === "error") console.error(line);
  else if (level === "warn") console.warn(line);
}

export function serverLogText(): string {
  if (!entries.length) return "(no server events since the container started)";
  return entries.map((e) => `${e.t} ${e.level.toUpperCase()} ${e.msg}`).join("\n");
}

/** Server half of the copyable debug report: what's configured (never secret values) plus recent events. */
export function serverReport(): string {
  const env = process.env;
  const flag = (v: string | undefined) => (v && v.trim() ? "set" : "not set");
  const lines = [
    `uptime: ${Math.round(process.uptime())}s`,
    `runtime: ${(process.versions as Record<string, string | undefined>)["bun"] ? `bun ${(process.versions as Record<string, string | undefined>)["bun"]}` : `node ${process.versions.node}`}`,
    `SEARXNG_URL: ${env["SEARXNG_URL"] ?? "(default)"}`,
    `SEERR_URL: ${flag(env["SEERR_URL"])}${env["SEERR_URL"] ? ` (${env["SEERR_URL"]})` : ""}`,
    `SEERR_API_KEY: ${flag(env["SEERR_API_KEY"])}`,
    `BUDDY_PASSWORD: ${flag(env["BUDDY_PASSWORD"])}`,
    `accounts: ${(env["BUDDY_DATA_DIR"] ?? "").trim() && (env["BUDDY_ACCOUNTS"] ?? "").trim() !== "0" ? "on" : "off"}`,
    `BUDDY_DATA_DIR: ${env["BUDDY_DATA_DIR"] ?? "(not set)"}`,
    "",
    serverLogText(),
  ];
  return lines.join("\n");
}

import { redact, describeError } from "./redact";

/** Browser-side event log: errors, failed requests and engine problems, kept so you can copy it into a bug report. */
export type LogLevel = "info" | "warn" | "error";
export type LogEntry = { t: string; level: LogLevel; msg: string };
const KEY = "pixel-pals-debuglog-v1";
export const MAX_ENTRIES = 200;

/** Newest-last list, capped. Pure so it can be tested. */
export function pushEntry(list: LogEntry[], entry: LogEntry, max = MAX_ENTRIES): LogEntry[] {
  const next = [...list, entry];
  return next.length > max ? next.slice(next.length - max) : next;
}

export function formatEntries(list: LogEntry[]): string {
  return list.length ? list.map((e) => `${e.t} ${e.level.toUpperCase()} ${e.msg}`).join("\n") : "(nothing logged in this browser yet)";
}

let memory: LogEntry[] = [];
const listeners = new Set<() => void>();
let loaded = false;

function load() {
  if (loaded) return;
  loaded = true;
  try {
    const raw = typeof localStorage !== "undefined" ? localStorage.getItem(KEY) : null;
    const parsed: unknown = raw ? JSON.parse(raw) : [];
    if (Array.isArray(parsed)) memory = parsed.filter((e): e is LogEntry => !!e && typeof e.t === "string" && typeof e.msg === "string" && typeof e.level === "string").slice(-MAX_ENTRIES);
  } catch { /* corrupt or unavailable: start empty */ }
}

export function logClient(level: LogLevel, msg: string, error?: unknown): void {
  load();
  const text = redact(error === undefined ? msg : `${msg} — ${describeError(error)}`).slice(0, 2000);
  memory = pushEntry(memory, { t: new Date().toISOString(), level, msg: text });
  try { localStorage.setItem(KEY, JSON.stringify(memory)); } catch { /* storage full: keep in memory only */ }
  listeners.forEach((fn) => fn());
}

export function clearClientLog(): void {
  memory = [];
  loaded = true;
  try { localStorage.removeItem(KEY); } catch { /* ignore */ }
  listeners.forEach((fn) => fn());
}

export function clientLog(): LogEntry[] {
  load();
  return memory;
}

export function subscribeLog(fn: () => void): () => void {
  listeners.add(fn);
  return () => { listeners.delete(fn); };
}

let installed = false;
/** Catches uncaught errors, unhandled rejections and failed /api calls. Call once in the browser. */
export function installGlobalLogging(): void {
  if (installed || typeof window === "undefined") return;
  installed = true;
  window.addEventListener("error", (e) => logClient("error", `window error at ${e.filename}:${e.lineno}`, e.error ?? e.message));
  window.addEventListener("unhandledrejection", (e) => logClient("error", "unhandled promise rejection", e.reason));
  const original = window.fetch.bind(window);
  window.fetch = async (input, init) => {
    const url = typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
    const local = url.startsWith("/api/");
    try {
      const res = await original(input, init);
      if (local && !res.ok && res.status !== 499) logClient("warn", `${init?.method ?? "GET"} ${url.split("?")[0]} -> ${res.status}`);
      return res;
    } catch (err) {
      if (local && !(err instanceof DOMException && err.name === "AbortError")) logClient("error", `${init?.method ?? "GET"} ${url.split("?")[0]} failed to connect`, err);
      throw err;
    }
  };
}

/** Everything worth pasting into a bug report. Secrets are stripped by redact(). */
export function buildReport(parts: { app: string; context: string[]; server: string; client: LogEntry[] }): string {
  const ua = typeof navigator !== "undefined" ? navigator.userAgent : "unknown";
  return redact([
    "=== Pixel Pals debug report ===",
    `time: ${new Date().toISOString()}`,
    `app: ${parts.app}`,
    `browser: ${ua}`,
    ...parts.context,
    "",
    "--- server ---",
    parts.server,
    "",
    "--- browser log ---",
    formatEntries(parts.client),
  ].join("\n"));
}

/** "10", "10s", "90 sec", "2m", "2 min" -> seconds (default 10, at most 1 hour). */
export function parseWindowSeconds(arg: string): number | null {
  const t = arg.trim().toLowerCase();
  if (!t) return 10;
  const m = t.match(/^(\d{1,5})\s*(s|sec|secs|seconds?|m|min|mins|minutes?)?$/);
  if (!m) return null;
  const n = Number(m[1]);
  const secs = m[2] && m[2].startsWith("m") ? n * 60 : n;
  return secs >= 1 ? Math.min(secs, 3600) : null;
}

/** Browser log entries from the last `seconds` seconds. */
export function entriesSince(list: LogEntry[], nowMs: number, seconds: number): LogEntry[] {
  const from = nowMs - seconds * 1000;
  return list.filter((e) => { const t = Date.parse(e.t); return Number.isFinite(t) && t >= from; });
}

/** Server log lines (each starts with an ISO time) from the last `seconds` seconds. Lines without a time stay with the line before. */
export function serverLinesSince(text: string, nowMs: number, seconds: number): string[] {
  const from = nowMs - seconds * 1000;
  const out: string[] = [];
  let keep = false;
  for (const line of text.split("\n")) {
    const m = line.match(/^(\d{4}-\d{2}-\d{2}T[\d:.]+Z)\s/);
    if (m) keep = Date.parse(m[1]!) >= from;
    if ((m || out.length) && keep) out.push(line);
  }
  return out;
}

/** The text file `@log` downloads. */
export function buildRecentReport(parts: { app: string; context: string[]; seconds: number; nowMs: number; server: string; client: LogEntry[] }): string {
  const ua = typeof navigator !== "undefined" ? navigator.userAgent : "unknown";
  const client = entriesSince(parts.client, parts.nowMs, parts.seconds);
  const server = serverLinesSince(parts.server, parts.nowMs, parts.seconds);
  return redact([
    `=== Pixel Pals log, last ${parts.seconds} seconds ===`,
    `time: ${new Date(parts.nowMs).toISOString()}`,
    `app: ${parts.app}`,
    `browser: ${ua}`,
    ...parts.context,
    "",
    "--- server ---",
    server.length ? server.join("\n") : `(no server events in the last ${parts.seconds} seconds)`,
    "",
    "--- browser log ---",
    client.length ? formatEntries(client) : `(nothing logged in this browser in the last ${parts.seconds} seconds)`,
  ].join("\n"));
}

import { servicesReport, type ServiceRow } from "./status";
import { backupText, backupConfig } from "./backup.server";
import { unraidConfig, unraidSnapshot } from "./unraid.server";
import { ollamaBase } from "./ollama.server";

const env = (k: string) => (process.env[k] ?? "").trim().replace(/\/+$/, "");

async function ping(name: string, url: string, path = "", headers: Record<string, string> = {}): Promise<ServiceRow> {
  if (!url) return { name, state: "off" };
  try {
    const res = await fetch(`${url}${path}`, { headers, signal: AbortSignal.timeout(3500) });
    if (res.status === 401 || res.status === 403) return { name, state: "down", note: "reachable, but the key/token was refused" };
    return res.status < 500 ? { name, state: "ok" } : { name, state: "down", note: `HTTP ${res.status}` };
  } catch (e) {
    return { name, state: "down", note: e instanceof Error && e.name === "TimeoutError" ? "no answer" : "can't connect" };
  }
}

/** Everything the app can reach, in one parallel pass. Read-only. */
export async function collectStatus(): Promise<string> {
  const plexToken = env("PLEX_TOKEN");
  const rows = await Promise.all([
    ping("Local AI (Ollama)", ollamaBase(), "/api/tags"),
    ping("Web search (SearXNG)", env("SEARXNG_URL") || "http://localhost:8081"),
    ping("Plex", env("PLEX_URL"), "/identity", plexToken ? { "X-Plex-Token": plexToken } : {}),
    ping("Seerr", env("SEERR_URL"), "/api/v1/status"),
    ping("Jellyfin", env("JELLYFIN_URL"), "/System/Ping"),
  ]);
  const snap = unraidSnapshot();
  if (!unraidConfig()) rows.push({ name: "Unraid", state: "off" });
  else if (!snap) rows.push({ name: "Unraid", state: "ok", note: "waiting for first check" });
  else rows.push(snap.reachable ? { name: "Unraid", state: "ok" } : { name: "Unraid", state: "down", note: "not answering" });
  rows.push(env("TRAKT_CLIENT_ID") ? { name: "Trakt", state: "ok", note: "configured" } : { name: "Trakt", state: "off" });
  rows.push(env("NTFY_URL") ? { name: "Phone alerts (ntfy)", state: "ok", note: "configured" } : { name: "Phone alerts (ntfy)", state: "off" });
  const extra = [backupConfig() ? `Backups: ${(await backupText()).split("\n")[0]}` : "Backups: off"];
  const data = await (await import("./migrate.server")).migrationStatusLine().catch(() => null);
  if (data) extra.push(data);
  return servicesReport(rows, extra);
}

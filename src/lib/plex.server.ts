import { logServer } from "./server-log.server";
import { shapePlex } from "./plex";

/** Plex address and token live only in the server's environment; the browser never sees them. */
export function plexConfig(env: Record<string, string | undefined> = process.env): { base: string; token: string } | null {
  const base = (env["PLEX_URL"] ?? "").trim().replace(/\/+$/, "");
  const token = (env["PLEX_TOKEN"] ?? "").trim();
  if (!base || !token) return null;
  try {
    const p = new URL(base).protocol;
    return p === "http:" || p === "https:" ? { base, token } : null;
  } catch { return null; }
}

export async function handlePlex(request: Request) {
  const cfg = plexConfig();
  if (!cfg) return Response.json({ error: "Plex isn't set up. Add PLEX_URL and PLEX_TOKEN to the environment and restart." }, { status: 503 });
  const url = new URL(request.url);
  const q = url.searchParams.get("q")?.trim() ?? "";
  if (q.length > 200) return Response.json({ error: "That search is too long." }, { status: 400 });
  const mode = url.searchParams.get("mode");
  const path = q && q.toLowerCase() !== "recent" && mode !== "pool"
    ? `/hubs/search?${new URLSearchParams({ query: q, limit: "12" })}`
    : `/library/recentlyAdded?${new URLSearchParams({ "X-Plex-Container-Start": "0", "X-Plex-Container-Size": mode === "pool" ? "80" : "30" })}`;
  try {
    const res = await fetch(`${cfg.base}${path}`, { headers: { "X-Plex-Token": cfg.token, Accept: "application/json" }, signal: AbortSignal.timeout(10000) });
    if (res.status === 401) return Response.json({ error: "Plex rejected the token — check PLEX_TOKEN." }, { status: 502 });
    if (!res.ok) {
      logServer("warn", `Plex answered ${res.status}`);
      return Response.json({ error: `Plex answered ${res.status}.` }, { status: 502 });
    }
    return Response.json({ items: shapePlex(await res.json(), mode === "pool" ? 60 : 12) });
  } catch (error) {
    logServer("error", `Can't reach Plex at ${cfg.base}`, error);
    return Response.json({ error: `Can't reach Plex at ${cfg.base}.` }, { status: 502 });
  }
}

import { logServer } from "./server-log.server";
import { isSlug, markWatched, shapeTrakt, shapeTraktLists, watchedMovieIds } from "./trakt";

const API = "https://api.trakt.tv";

/**
 * Trakt needs a free "client id" (trakt.tv/oauth/applications). Public lists only need that;
 * TRAKT_ACCESS_TOKEN is optional and unlocks private lists. All of it stays on the server.
 */
export function traktConfig(env: Record<string, string | undefined> = process.env): { clientId: string; user: string; list: string; token: string } | null {
  const clientId = (env["TRAKT_CLIENT_ID"] ?? "").trim();
  const user = (env["TRAKT_USER"] ?? "").trim().replace(/^@/, "");
  if (!clientId || !isSlug(user)) return null;
  const list = (env["TRAKT_LIST"] ?? "watchlist").trim() || "watchlist";
  return { clientId, user, list: isSlug(list) ? list : "watchlist", token: (env["TRAKT_ACCESS_TOKEN"] ?? "").trim() };
}

export async function handleTrakt(request: Request) {
  const cfg = traktConfig();
  if (!cfg) return Response.json({ error: "Trakt isn't set up. Add TRAKT_CLIENT_ID and TRAKT_USER (and optionally TRAKT_LIST) to the environment and restart." }, { status: 503 });
  const url = new URL(request.url);
  const wantLists = url.searchParams.get("mode") === "lists";
  const list = (url.searchParams.get("list") ?? "").trim() || cfg.list;
  if (!isSlug(list)) return Response.json({ error: "That isn't a valid Trakt list name — use the short name shown by /trakt lists." }, { status: 400 });
  const headers: Record<string, string> = { "Content-Type": "application/json", "trakt-api-version": "2", "trakt-api-key": cfg.clientId };
  if (cfg.token) headers["Authorization"] = `Bearer ${cfg.token}`;
  const get = (path: string) => fetch(`${API}${path}`, { headers, signal: AbortSignal.timeout(10000) });
  const user = encodeURIComponent(cfg.user);
  try {
    if (wantLists) {
      const res = await get(`/users/${user}/lists`);
      const bad = failure(res.status, "lists");
      if (bad) return bad;
      return Response.json({ lists: shapeTraktLists(await res.json()) });
    }
    const path = list === "watchlist" ? `/users/${user}/watchlist` : `/users/${user}/lists/${encodeURIComponent(list)}/items`;
    const res = await get(path);
    const bad = failure(res.status, list);
    if (bad) return bad;
    let items = shapeTrakt(await res.json());
    // Best effort: hide movies already watched. Needs the watch history to be public (or a token); skipped otherwise.
    try {
      const seen = await get(`/users/${user}/watched/movies`);
      if (seen.ok) items = markWatched(items, watchedMovieIds(await seen.json()));
    } catch { /* optional */ }
    return Response.json({ list, items });
  } catch (error) {
    logServer("error", "Can't reach Trakt", error);
    return Response.json({ error: "Can't reach Trakt (api.trakt.tv). Check the server's internet access." }, { status: 502 });
  }
}

function failure(status: number, what: string): Response | null {
  if (status >= 200 && status < 300) return null;
  if (status === 401 || status === 403) return Response.json({ error: "Trakt says that list is private. Make it public on trakt.tv, or add TRAKT_ACCESS_TOKEN." }, { status: 502 });
  if (status === 404) return Response.json({ error: `Trakt can't find “${what}” for that user. Check TRAKT_USER, and use /trakt lists to see the exact list names.` }, { status: 404 });
  if (status === 429) return Response.json({ error: "Trakt is rate-limiting requests. Try again in a minute." }, { status: 502 });
  logServer("warn", `Trakt answered ${status}`);
  return Response.json({ error: `Trakt answered ${status}.` }, { status: 502 });
}

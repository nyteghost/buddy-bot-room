import { accountsEnabled } from "./accounts";
import { currentUser, tokenUser } from "./accounts.server";
import { buildPool, buildReport, counts, decide, missingFromNote, needsSearch, parseNote, searchKey, shapeHistory, shapeSearch, type Candidate } from "./notes-sync";
import { logServer } from "./server-log.server";
import { isSlug, shapeTrakt } from "./trakt";
import { traktConfig, traktGet } from "./trakt.server";

const MAX_NOTE = 20_000;
const MAX_SEARCHES = 25;

/**
 * POST the note text (plain text body, or JSON {"note": "..."}). Query: list=<trakt list>, skip=<first lines to ignore>,
 * format=json (default) | note (updated note text) | report (what changed, as text).
 * Read-only on Trakt. With accounts on, needs a signed-in session or an access token.
 */
export async function handleNotesSync(request: Request) {
  if (request.method !== "POST") return Response.json({ error: "Send the note with POST." }, { status: 405 });
  if (accountsEnabled(process.env) && !(await currentUser(request)) && !(await tokenUser(request))) return Response.json({ error: "Sign in, or send your access token as 'Authorization: Bearer …'." }, { status: 401 });
  const cfg = traktConfig();
  if (!cfg) return Response.json({ error: "Trakt isn't set up. Add TRAKT_CLIENT_ID and TRAKT_USER to the environment and restart." }, { status: 503 });
  const url = new URL(request.url);
  const list = (url.searchParams.get("list") ?? "").trim() || cfg.list;
  if (!isSlug(list)) return Response.json({ error: "That isn't a valid Trakt list name — use the short name shown by /trakt lists." }, { status: 400 });
  const skip = Math.min(20, Math.max(0, Number.parseInt(url.searchParams.get("skip") ?? "0", 10) || 0));
  const format = url.searchParams.get("format") ?? "json";

  let note = "";
  const text = await request.text();
  if ((request.headers.get("content-type") ?? "").includes("json")) {
    try { const j = JSON.parse(text) as { note?: unknown }; note = typeof j.note === "string" ? j.note : ""; } catch { note = ""; }
  } else note = text;
  if (!note.trim()) return Response.json({ error: "The note was empty." }, { status: 400 });
  if (note.length > MAX_NOTE) return Response.json({ error: "That note is too long (20,000 characters at most)." }, { status: 413 });

  const user = encodeURIComponent(cfg.user);
  try {
    const listRes = await traktGet(cfg, list === "watchlist" ? `/users/${user}/watchlist` : `/users/${user}/lists/${encodeURIComponent(list)}/items`);
    if (!listRes.ok) {
      const why = listRes.status === 404 ? `Trakt can't find the list “${list}”.` : listRes.status === 401 || listRes.status === 403 ? "That Trakt list is private. Make it public, or add TRAKT_ACCESS_TOKEN." : `Trakt answered ${listRes.status}.`;
      return Response.json({ error: why }, { status: 502 });
    }
    const listItems: Candidate[] = shapeTrakt(await listRes.json(), 500);
    let historyOk = true;
    const history = async (kind: "movies" | "shows"): Promise<Candidate[]> => {
      try {
        const r = await traktGet(cfg, `/users/${user}/watched/${kind}`);
        if (!r.ok) { historyOk = false; return []; }
        return shapeHistory(await r.json(), kind === "movies" ? "movie" : "show");
      } catch { historyOk = false; return []; }
    };
    const [movies, shows] = await Promise.all([history("movies"), history("shows")]);
    const pool = buildPool(listItems, movies, shows);
    const lines = parseNote(note, skip);

    const searched = new Map<string, Candidate[]>();
    const todo = needsSearch(lines, pool).slice(0, MAX_SEARCHES);
    for (let i = 0; i < todo.length; i += 5) {
      await Promise.all(todo.slice(i, i + 5).map(async (l) => {
        try {
          const q = new URLSearchParams({ query: l.title, limit: "6", ...(l.year ? { years: String(l.year) } : {}) });
          const r = await traktGet(cfg, `/search/movie,show?${q}`);
          if (r.ok) searched.set(searchKey(l), shapeSearch(await r.json()));
        } catch { /* a failed search just leaves that line as "couldn't find" */ }
      }));
    }

    const results = decide(lines, pool, searched);
    const report = buildReport(results, missingFromNote(lines, pool), { date: new Date().toISOString().slice(0, 10), list, historyOk });
    const updated = results.map((r) => r.newRaw).join("\n");
    if (format === "note") return new Response(updated, { headers: { "content-type": "text/plain; charset=utf-8", "cache-control": "no-store" } });
    if (format === "report") return new Response(report, { headers: { "content-type": "text/plain; charset=utf-8", "cache-control": "no-store" } });
    return Response.json({ note: updated, report, counts: counts(results), historyOk }, { headers: { "cache-control": "no-store" } });
  } catch (error) {
    logServer("error", "note sync failed", error);
    return Response.json({ error: "Can't reach Trakt (api.trakt.tv). Check the server's internet access." }, { status: 502 });
  }
}

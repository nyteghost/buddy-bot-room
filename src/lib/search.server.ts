import { logServer } from "./server-log.server";
import { shapeResults } from "./search";
import { TtlCache } from "./ttl-cache";

/** Repeated searches within 5 minutes are answered from memory instead of hitting SearXNG again. */
const cache = new TtlCache<unknown>(5 * 60 * 1000, 50);

/** SearXNG address comes only from the server's environment — never from the request. */
function searxngBase(): string | null {
  const raw = (process.env["SEARXNG_URL"] ?? "http://localhost:8081").trim().replace(/\/+$/, "");
  try {
    const url = new URL(raw);
    return url.protocol === "http:" || url.protocol === "https:" ? raw : null;
  } catch {
    return null;
  }
}

export async function handleSearch(request: Request) {
  const q = new URL(request.url).searchParams.get("q")?.trim() ?? "";
  if (!q || q.length > 300) return Response.json({ error: "Give me something to search for (under 300 characters)." }, { status: 400 });
  const base = searxngBase();
  if (!base) return Response.json({ error: "SEARXNG_URL is not a valid http(s) address." }, { status: 500 });
  const cached = cache.get(`${base}|${q.toLowerCase()}`);
  if (cached) return Response.json({ query: q, hits: cached, cached: true });
  try {
    const res = await fetch(`${base}/search?${new URLSearchParams({ q, format: "json" })}`, {
      headers: { Accept: "application/json" },
      signal: AbortSignal.timeout(8000),
    });
    if (!res.ok) logServer("warn", `SearXNG ${base} answered ${res.status}`);
    if (res.status === 403)
      return Response.json({ error: "SearXNG refused the request. Add `json` to search.formats in its settings.yml." }, { status: 502 });
    if (!res.ok) return Response.json({ error: `SearXNG answered ${res.status}.` }, { status: 502 });
    const hits = shapeResults(await res.json());
    cache.set(`${base}|${q.toLowerCase()}`, hits);
    return Response.json({ query: q, hits });
  } catch (error) {
    logServer("error", `Can't reach SearXNG at ${base}`, error);
    return Response.json({ error: `Can't reach SearXNG at ${base}. Set SEARXNG_URL in .env.` }, { status: 502 });
  }
}

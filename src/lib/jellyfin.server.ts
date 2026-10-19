import { shapeLibrary } from "./jellyfin";
import { logServer } from "./server-log.server";

/** Jellyfin address and API key live only in the server's environment. */
function config(): { base: string; key: string; publicUrl: string } | null {
  const base = (process.env["JELLYFIN_URL"] ?? "").trim().replace(/\/+$/, "");
  const key = (process.env["JELLYFIN_API_KEY"] ?? "").trim();
  if (!base || !key) return null;
  try {
    const url = new URL(base);
    if (url.protocol !== "http:" && url.protocol !== "https:") return null;
  } catch { return null; }
  return { base, key, publicUrl: (process.env["JELLYFIN_PUBLIC_URL"] ?? "").trim() };
}

export async function handleJellyfin(request: Request) {
  const cfg = config();
  if (!cfg) return Response.json({ error: "Jellyfin isn't set up. Add JELLYFIN_URL and JELLYFIN_API_KEY to the environment and restart." }, { status: 503 });
  const q = new URL(request.url).searchParams.get("q")?.trim() ?? "";
  if (q.length > 200) return Response.json({ error: "That search is too long." }, { status: 400 });
  const params = new URLSearchParams({ IncludeItemTypes: "Movie,Series", Recursive: "true", Limit: "8", Fields: "Overview" });
  if (!q || q.toLowerCase() === "recent") { params.set("SortBy", "DateCreated"); params.set("SortOrder", "Descending"); params.set("Limit", "10"); }
  else params.set("searchTerm", q);
  try {
    const res = await fetch(`${cfg.base}/Items?${params}`, { headers: { "X-Emby-Token": cfg.key, Accept: "application/json" }, signal: AbortSignal.timeout(10000) });
    if (!res.ok) {
      logServer("warn", `Jellyfin answered ${res.status}`);
      return Response.json({ error: `Jellyfin answered ${res.status} — check JELLYFIN_API_KEY.` }, { status: 502 });
    }
    return Response.json({ items: shapeLibrary(await res.json(), q.toLowerCase() === "recent" || !q ? 10 : 8), publicUrl: cfg.publicUrl || undefined });
  } catch (error) {
    logServer("error", `Can't reach Jellyfin at ${cfg.base}`, error);
    return Response.json({ error: `Can't reach Jellyfin at ${cfg.base}.` }, { status: 502 });
  }
}

import { shapeSeerr } from "./seerr";

/** Seerr address and API key live only in the server's environment; the browser never sees them. */
function config(): { base: string; key: string } | null {
  const base = (process.env["SEERR_URL"] ?? "").trim().replace(/\/+$/, "");
  const key = (process.env["SEERR_API_KEY"] ?? "").trim();
  if (!base || !key) return null;
  try {
    const url = new URL(base);
    return url.protocol === "http:" || url.protocol === "https:" ? { base, key } : null;
  } catch {
    return null;
  }
}
const notSetUp = () =>
  Response.json({ error: "Seerr isn't set up. Add SEERR_URL and SEERR_API_KEY to .env and restart." }, { status: 503 });

export async function handleSeerr(request: Request) {
  const cfg = config();
  if (!cfg) return notSetUp();
  const headers = { "X-Api-Key": cfg.key, Accept: "application/json" };
  try {
    if (request.method === "GET") {
      const q = new URL(request.url).searchParams.get("q")?.trim() ?? "";
      if (!q || q.length > 200) return Response.json({ error: "Tell me which title to look up." }, { status: 400 });
      const res = await fetch(`${cfg.base}/api/v1/search?query=${encodeURIComponent(q)}&page=1`, {
        headers,
        signal: AbortSignal.timeout(10000),
      });
      if (!res.ok) return Response.json({ error: `Seerr answered ${res.status} — check SEERR_API_KEY.` }, { status: 502 });
      return Response.json({ results: shapeSeerr(await res.json()) });
    }
    const body = await request.json().catch(() => null);
    const mediaType = body?.mediaType;
    const mediaId = body?.mediaId;
    if ((mediaType !== "movie" && mediaType !== "tv") || !Number.isInteger(mediaId) || mediaId < 1)
      return Response.json({ error: "That request wasn't valid." }, { status: 400 });
    const payload: Record<string, unknown> = { mediaType, mediaId, is4k: body?.is4k === true };
    if (mediaType === "tv") payload["seasons"] = "all";
    const res = await fetch(`${cfg.base}/api/v1/request`, {
      method: "POST",
      headers: { ...headers, "Content-Type": "application/json" },
      body: JSON.stringify(payload),
      signal: AbortSignal.timeout(15000),
    });
    if (!res.ok) {
      const detail = (await res.json().catch(() => null))?.message;
      return Response.json({ error: typeof detail === "string" ? detail : `Seerr answered ${res.status}.` }, { status: 502 });
    }
    return Response.json({ ok: true });
  } catch {
    return Response.json({ error: `Can't reach Seerr at ${cfg.base}.` }, { status: 502 });
  }
}

/** Client-safe helpers for the @seerr request pal. */
export type SeerrQuery = { title: string; is4k: boolean };
export type SeerrResult = {
  id: number;
  mediaType: "movie" | "tv";
  title: string;
  year: string;
  overview: string;
  /** What Seerr already knows about it. */
  status: "available" | "requested" | "none";
  status4k: "available" | "requested" | "none";
};

const FOUR_K = /\b(4k|2160p|uhd)\b/i;
const HD = /\b(1080p|720p|hd|fhd)\b/i;

/** "@seerr Dune Part Two 4k" → { title: "Dune Part Two", is4k: true }. Null if it isn't a @seerr message. */
export function parseSeerr(text: string): SeerrQuery | null {
  const m = text.trim().match(/^@seerr\b\s*([\s\S]*)$/i);
  if (!m) return null;
  let rest = m[1] ?? "";
  const is4k = FOUR_K.test(rest);
  rest = rest.replace(FOUR_K, " ").replace(HD, " ").replace(/\s+/g, " ").trim();
  return { title: rest, is4k };
}

/** Seerr media status codes: 2 pending, 3 processing, 4 partially available, 5 available. */
export function statusOf(code: unknown): SeerrResult["status"] {
  if (code === 5 || code === 4) return "available";
  if (code === 2 || code === 3) return "requested";
  return "none";
}

type RawResult = {
  id?: unknown;
  mediaType?: unknown;
  title?: unknown;
  name?: unknown;
  releaseDate?: unknown;
  firstAirDate?: unknown;
  overview?: unknown;
  mediaInfo?: { status?: unknown; status4k?: unknown };
};

export function shapeSeerr(data: unknown, limit = 5): SeerrResult[] {
  const results = (data as { results?: unknown[] } | null)?.results;
  if (!Array.isArray(results)) return [];
  const out: SeerrResult[] = [];
  for (const r of results as RawResult[]) {
    if (r?.mediaType !== "movie" && r?.mediaType !== "tv") continue;
    if (typeof r.id !== "number" || !Number.isInteger(r.id)) continue;
    const date = String(r.releaseDate ?? r.firstAirDate ?? "");
    out.push({
      id: r.id,
      mediaType: r.mediaType,
      title: String(r.title ?? r.name ?? "Untitled").slice(0, 120),
      year: date.slice(0, 4),
      overview: String(r.overview ?? "").slice(0, 240),
      status: statusOf(r.mediaInfo?.status),
      status4k: statusOf(r.mediaInfo?.status4k),
    });
    if (out.length >= limit) break;
  }
  return out;
}

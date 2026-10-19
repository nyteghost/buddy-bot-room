/** Pure helpers for writing to Trakt (watchlist / history). */
export type WriteOp = "connect" | "add" | "watched" | "remove" | "status";
export type Match = { kind: "movie" | "show"; title: string; year?: number; id: number };

export function parseWrite(arg: string): { op: WriteOp; text: string } | null {
  const m = /^(connect|add|watched|seen|remove|rm|status)\b\s*([\s\S]*)$/i.exec(arg.trim());
  if (!m) return null;
  const word = (m[1] ?? "").toLowerCase();
  const op: WriteOp = word === "seen" ? "watched" : word === "rm" ? "remove" : (word as WriteOp);
  return { op, text: (m[2] ?? "").trim().slice(0, 120) };
}

/** First usable result from Trakt's /search/movie,show response. */
export function bestMatch(json: unknown): Match | null {
  if (!Array.isArray(json)) return null;
  for (const r of json as Record<string, unknown>[]) {
    const kind = r["type"] === "movie" ? "movie" : r["type"] === "show" ? "show" : null;
    const item = kind ? (r[kind] as Record<string, unknown> | undefined) : undefined;
    const ids = item?.["ids"] as Record<string, unknown> | undefined;
    const id = Number(ids?.["trakt"]);
    if (kind && item && Number.isInteger(id) && typeof item["title"] === "string") {
      const year = Number(item["year"]);
      return { kind, title: item["title"], ...(Number.isInteger(year) && year > 1800 ? { year } : {}), id };
    }
  }
  return null;
}

/** Body for POST /sync/watchlist, /sync/watchlist/remove or /sync/history. */
export function syncBody(m: Match): Record<string, unknown> {
  const entry = { ids: { trakt: m.id } };
  return m.kind === "movie" ? { movies: [entry] } : { shows: [entry] };
}

export function describeMatch(m: Match): string {
  return `${m.title}${m.year ? ` (${m.year})` : ""} — ${m.kind}`;
}

/** Seconds to wait between polls, never faster than Trakt asks, never slower than a minute. */
export const pollSeconds = (interval: unknown): number => Math.min(60, Math.max(5, Number(interval) || 5));

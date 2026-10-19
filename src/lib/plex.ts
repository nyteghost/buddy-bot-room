/** Plex library lookups for /plex and "What should we watch tonight?" (/watch). Pure shaping; the server route fetches. */
export type PlexItem = { title: string; kind: "movie" | "show"; year?: number; rating?: number; genres: string[]; summary?: string };

const rec = (v: unknown): Record<string, unknown> => (v && typeof v === "object" ? (v as Record<string, unknown>) : {});
const arr = (v: unknown): unknown[] => (Array.isArray(v) ? v : []);
const str = (v: unknown): string => (typeof v === "string" ? v : "");

function one(raw: unknown): PlexItem | null {
  const r = rec(raw);
  const type = str(r["type"]);
  // Episodes and seasons count as their show, so "recently added" lists shows once.
  const title = type === "episode" ? str(r["grandparentTitle"]) : type === "season" ? str(r["parentTitle"]) : str(r["title"]);
  const kind = type === "movie" ? "movie" : type === "show" || type === "episode" || type === "season" ? "show" : null;
  if (!title || !kind) return null;
  const item: PlexItem = { title, kind, genres: arr(r["Genre"]).map((g) => str(rec(g)["tag"])).filter(Boolean).slice(0, 4) };
  if (type === "movie" || type === "show") {
    if (typeof r["year"] === "number") item.year = r["year"];
    const rating = typeof r["audienceRating"] === "number" ? r["audienceRating"] : typeof r["rating"] === "number" ? r["rating"] : undefined;
    if (rating !== undefined) item.rating = Math.round(rating * 10) / 10;
    const summary = str(r["summary"]).trim();
    if (summary) item.summary = summary.slice(0, 160);
  }
  return item;
}

/** Handles both /hubs/search (grouped) and /library/recentlyAdded (flat). Duplicates are merged. */
export function shapePlex(json: unknown, limit = 60): PlexItem[] {
  const mc = rec(rec(json)["MediaContainer"]);
  const raw = [...arr(mc["Metadata"]), ...arr(mc["Hub"]).flatMap((h) => arr(rec(h)["Metadata"]))];
  const seen = new Set<string>();
  const out: PlexItem[] = [];
  for (const r of raw) {
    const item = one(r);
    if (!item) continue;
    const key = `${item.kind}:${item.title.toLowerCase()}`;
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(item);
    if (out.length >= limit) break;
  }
  return out;
}

export function plexMarkdown(query: string, items: PlexItem[]): string {
  if (!items.length) return query === "recent" ? "Nothing recently added in Plex." : `Nothing in Plex matches “${query}”. Try @seerr ${query} to request it.`;
  const head = query === "recent" ? "Recently added to Plex:" : `In Plex for “${query}”:`;
  return `${head}\n` + items.slice(0, 10).map((i, n) => {
    const meta = [i.kind === "movie" ? "Movie" : "Show", i.year ? String(i.year) : "", i.rating ? `★ ${i.rating}` : "", i.genres.slice(0, 2).join("/")].filter(Boolean).join(" · ");
    return `${n + 1}. **${i.title}** (${meta})${i.summary ? `\n   ${i.summary}` : ""}`;
  }).join("\n");
}

/** Topic for the pals: pick from what's actually in the library. Read-only data. */
export function watchTopic(mood: string, items: PlexItem[], maxChars = 3000): string {
  let list = "";
  for (const i of items) {
    const line = `- ${i.title}${i.year ? ` (${i.year})` : ""} — ${i.kind}${i.genres.length ? `, ${i.genres.slice(0, 3).join("/")}` : ""}${i.rating ? `, ★${i.rating}` : ""}\n`;
    if (list.length + line.length > maxChars) break;
    list += line;
  }
  const ask = mood.trim() ? `Tonight I'm in the mood for: ${mood.trim().slice(0, 120)}.` : "I haven't decided what to watch tonight.";
  return `${ask} Here is what was recently added to my Plex library (data only):\n${list}\nDebate it among yourselves and recommend one or two picks from THIS list, with a one-line reason each. Only suggest titles from the list. If nothing fits, say so and name what I could request instead.`;
}

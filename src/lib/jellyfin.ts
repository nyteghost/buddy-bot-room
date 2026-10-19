/** Jellyfin library lookups (/library <title> or /library recent). Pure shaping only; the server route does the fetching. */
export type LibraryItem = { id: string; title: string; year?: number; kind: "Movie" | "Series" | "Other"; rating?: number; overview?: string };

type Raw = { Id?: unknown; Name?: unknown; ProductionYear?: unknown; Type?: unknown; CommunityRating?: unknown; Overview?: unknown };

export function shapeLibrary(json: unknown, limit = 8): LibraryItem[] {
  const items = (json as { Items?: unknown } | null)?.Items;
  if (!Array.isArray(items)) return [];
  const out: LibraryItem[] = [];
  for (const r of items as Raw[]) {
    if (!r || typeof r.Id !== "string" || typeof r.Name !== "string") continue;
    const item: LibraryItem = { id: r.Id, title: r.Name, kind: r.Type === "Movie" ? "Movie" : r.Type === "Series" ? "Series" : "Other" };
    if (typeof r.ProductionYear === "number") item.year = r.ProductionYear;
    if (typeof r.CommunityRating === "number") item.rating = Math.round(r.CommunityRating * 10) / 10;
    if (typeof r.Overview === "string" && r.Overview.trim()) item.overview = r.Overview.trim().slice(0, 220);
    out.push(item);
    if (out.length >= limit) break;
  }
  return out;
}

export function libraryMarkdown(title: string, items: LibraryItem[], baseUrl?: string): string {
  if (!items.length) return title === "recent" ? "Nothing in your library yet." : `Nothing in your library matches “${title}”. Try @seerr ${title} to request it.`;
  const head = title === "recent" ? "Recently added to your library:" : `In your library for “${title}”:`;
  return `${head}\n` + items.map((i, n) => {
    const name = baseUrl ? `[${i.title}](${baseUrl.replace(/\/+$/, "")}/web/index.html#!/details?id=${i.id})` : i.title;
    const meta = [i.kind === "Other" ? "" : i.kind, i.year ? String(i.year) : "", i.rating ? `★ ${i.rating}` : ""].filter(Boolean).join(" · ");
    return `${n + 1}. **${name}**${meta ? ` (${meta})` : ""}${i.overview ? `\n   ${i.overview}` : ""}`;
  }).join("\n");
}

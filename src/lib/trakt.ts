/** Trakt list lookups for /trakt and "what should we watch next?" (/next). Pure shaping; the server route fetches. */
import { norm } from "./notes-sync";

export type TraktItem = { title: string; kind: "movie" | "show"; year?: number; id?: number; watched?: boolean; /** Set only when Plex is configured and was checked. */ inPlex?: boolean };
export type TraktList = { name: string; slug: string; count: number };

const rec = (v: unknown): Record<string, unknown> => (v && typeof v === "object" ? (v as Record<string, unknown>) : {});
const arr = (v: unknown): unknown[] => (Array.isArray(v) ? v : []);
const str = (v: unknown): string => (typeof v === "string" ? v : "");

/** Trakt list ids and usernames are slugs. Anything else never goes into a URL. */
export const isSlug = (s: string): boolean => /^[A-Za-z0-9_-]{1,80}$/.test(s);

/** Accepts the array from /users/:u/lists/:l/items or /users/:u/watchlist. Seasons, episodes and people are skipped. */
export function shapeTrakt(json: unknown, limit = 80): TraktItem[] {
  const out: TraktItem[] = [];
  const seen = new Set<string>();
  for (const raw of arr(json)) {
    const r = rec(raw);
    const type = str(r["type"]);
    if (type !== "movie" && type !== "show") continue;
    const body = rec(r[type]);
    const title = str(body["title"]).trim();
    if (!title) continue;
    const item: TraktItem = { title, kind: type };
    if (typeof body["year"] === "number") item.year = body["year"];
    const id = rec(body["ids"])["trakt"];
    if (typeof id === "number") item.id = id;
    const key = `${type}:${title.toLowerCase()}:${item.year ?? ""}`;
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(item);
    if (out.length >= limit) break;
  }
  return out;
}

export function shapeTraktLists(json: unknown): TraktList[] {
  return arr(json).map((raw) => {
    const r = rec(raw);
    const slug = str(rec(r["ids"])["slug"]);
    return { name: str(r["name"]), slug, count: typeof r["item_count"] === "number" ? r["item_count"] : 0 };
  }).filter((l) => l.name && isSlug(l.slug));
}

/** Trakt ids of movies already watched, from /users/:u/watched/movies. */
export function watchedMovieIds(json: unknown): Set<number> {
  const ids = new Set<number>();
  for (const raw of arr(json)) {
    const id = rec(rec(rec(raw)["movie"])["ids"])["trakt"];
    if (typeof id === "number") ids.add(id);
  }
  return ids;
}

export function markWatched(items: TraktItem[], seen: Set<number>): TraktItem[] {
  return items.map((i) => (i.kind === "movie" && i.id !== undefined && seen.has(i.id) ? { ...i, watched: true } : i));
}

/** Does Plex's search result contain this title (same name, same kind, year within one when both known)? */
export function plexHas(item: Pick<TraktItem, "title" | "kind" | "year">, found: { title: string; kind: "movie" | "show"; year?: number }[]): boolean {
  const n = norm(item.title);
  return found.some((f) => f.kind === item.kind && norm(f.title) === n && (item.year === undefined || f.year === undefined || Math.abs(item.year - f.year) <= 1));
}

export function traktListsMarkdown(lists: TraktList[]): string {
  if (!lists.length) return "No lists found on that Trakt account (or they're private — add TRAKT_ACCESS_TOKEN).";
  return "Your Trakt lists (use the name in brackets):\n" + lists.map((l, n) => `${n + 1}. **${l.name}** — ${l.count} item${l.count === 1 ? "" : "s"} [${l.slug}]`).join("\n") + "\n\nTry /trakt <list> or /next list:<list> [mood].";
}

export function traktMarkdown(list: string, items: TraktItem[]): string {
  if (!items.length) return `Nothing in the Trakt list “${list}”.`;
  const open = items.filter((i) => !i.watched);
  const head = `Trakt “${list}” — ${items.length} item${items.length === 1 ? "" : "s"}${open.length !== items.length ? `, ${open.length} unwatched` : ""}:`;
  return `${head}\n` + items.slice(0, 15).map((i, n) => `${n + 1}. **${i.title}**${i.year ? ` (${i.year})` : ""} · ${i.kind === "movie" ? "Movie" : "Show"}${i.watched ? " · ✓ watched" : i.inPlex === true ? " · 📺 in Plex" : i.inPlex === false ? " · not in Plex" : ""}`).join("\n") + (items.length > 15 ? `\n…and ${items.length - 15} more.` : "");
}

/** Topic for the pals: choose from the list (already-watched movies are left out). Read-only data. */
export function nextTopic(mood: string, listName: string, items: TraktItem[], maxChars = 3000): string {
  const checked = items.some((i) => i.inPlex !== undefined);
  let list = "";
  for (const i of items.filter((x) => !x.watched)) {
    const plex = i.inPlex === true ? " [in Plex]" : i.inPlex === false ? " [not in Plex]" : "";
    const line = `- ${i.title}${i.year ? ` (${i.year})` : ""} — ${i.kind}${plex}\n`;
    if (list.length + line.length > maxChars) break;
    list += line;
  }
  const ask = mood.trim() ? `I'm in the mood for: ${mood.trim().slice(0, 120)}.` : "I can't decide what to watch next.";
  const plexRule = checked ? " Prefer titles marked [in Plex], since I can watch those right now. If you recommend one marked [not in Plex], say it can be requested by typing /request followed by the title." : "";
  return `${ask} Here is my Trakt list “${listName.slice(0, 80)}” of things I want to watch (data only):\n${list}\nDebate it among yourselves and pick the one or two I should watch next from THIS list, with a one-line reason each. Only suggest titles from the list.${plexRule} If the list is empty or nothing fits, say so.`;
}

/**
 * Playtest and beta watch: the pure parts (reading feeds and web pages for listings, spotting new ones).
 * The server file fetches the sources on a timer, keeps what it found and alerts your phone.
 */
export type SourceKind = "rss" | "page";
export type Source = {
  id: string;
  name: string;
  kind: SourceKind;
  url: string;
  /** Only keep listings whose title has one of these words (comma separated). Empty keeps everything. */
  keywords?: string | undefined;
  /** Pages only: keep only links whose address contains this text, like "/app/". */
  match?: string | undefined;
  enabled: boolean;
};
export type Listing = { id: string; title: string; url: string; source: string; found: string; fresh: boolean };
export type SourceStatus = { at: string; ok: boolean; count: number; error?: string | undefined };
export type Store = { sources: Source[]; items: Listing[]; status: Record<string, SourceStatus>; lastRun: string };

export const MAX_SOURCES = 20;
export const MAX_ITEMS = 300;

export const DEFAULT_SOURCES: Source[] = [
  { id: "reddit-betatests", name: "Reddit r/BetaTests", kind: "rss", url: "https://www.reddit.com/r/BetaTests/new/.rss", enabled: true },
  { id: "reddit-playtesting", name: "Reddit r/playtesting", kind: "rss", url: "https://www.reddit.com/r/playtesting/new/.rss", enabled: true },
  { id: "playtester", name: "Playtester.io", kind: "page", url: "https://playtester.io", enabled: true },
  { id: "steam-playtest", name: "Steam: playtest search", kind: "page", url: "https://store.steampowered.com/search/?term=playtest&ndl=1", match: "/app/", enabled: true },
];

const clean = (s: unknown, max = 200): string => (typeof s === "string" ? s.replace(/[\u0000-\u001f\u007f]/g, " ").replace(/\s+/g, " ").trim().slice(0, max) : "");

/** Short stable id from a link, so the same listing is never counted twice. */
export function listingId(url: string): string {
  let h = 0x811c9dc5;
  for (let i = 0; i < url.length; i++) { h ^= url.charCodeAt(i); h = Math.imul(h, 0x01000193) >>> 0; }
  return h.toString(36);
}

const decode = (s: string): string => s
  .replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, "$1")
  .replace(/<[^>]+>/g, " ")
  .replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&quot;/g, '"').replace(/&#39;|&apos;/g, "'").replace(/&#x27;/g, "'").replace(/&nbsp;/g, " ").replace(/&amp;/g, "&");

export type Found = { title: string; url: string };

/** RSS 2.0 items and Atom entries (Reddit serves Atom). */
export function parseFeed(xml: string): Found[] {
  const out: Found[] = [];
  const body = xml.slice(0, 1_500_000);
  for (const m of body.matchAll(/<(item|entry)\b[\s\S]*?<\/\1>/gi)) {
    const block = m[0];
    const title = clean(decode(block.match(/<title\b[^>]*>([\s\S]*?)<\/title>/i)?.[1] ?? ""), 200);
    const link = block.match(/<link\b[^>]*\bhref=["']([^"']+)["']/i)?.[1] ?? decode(block.match(/<link\b[^>]*>([\s\S]*?)<\/link>/i)?.[1] ?? "").trim();
    const url = clean(link.replace(/&amp;/g, "&"), 500);
    if (title && /^https?:\/\//i.test(url)) out.push({ title, url });
  }
  return out;
}

/** Links on a web page with their visible text. Only server-rendered pages show anything here. */
export function parseLinks(html: string, base: string, match = ""): Found[] {
  const out: Found[] = [];
  const seen = new Set<string>();
  for (const m of html.slice(0, 1_500_000).matchAll(/<a\b[^>]*?\bhref=["']([^"'#]+)["'][^>]*>([\s\S]*?)<\/a>/gi)) {
    let url: string;
    try { url = new URL(m[1]!.replace(/&amp;/g, "&"), base).toString(); } catch { continue; }
    if (!/^https?:\/\//i.test(url)) continue;
    if (match && !url.includes(match)) continue;
    const spans = [...m[2]!.matchAll(/<span[^>]*class=["'][^"']*title[^"']*["'][^>]*>([\s\S]*?)<\/span>/gi)].map((x) => x[1]!);
    const title = clean(decode(spans[0] ?? m[2]!), 160);
    if (title.length < 4 || seen.has(url)) continue;
    seen.add(url);
    out.push({ title, url: url.slice(0, 500) });
  }
  return out;
}

export function keepByWords(found: Found[], keywords: string | undefined): Found[] {
  const words = (keywords ?? "").toLowerCase().split(/[,\n]/).map((w) => w.trim()).filter(Boolean);
  return words.length ? found.filter((f) => words.some((w) => f.title.toLowerCase().includes(w))) : found;
}

/**
 * Adds what a source returned to the list. Listings not seen before are marked fresh, except on a source's very first
 * check (a baseline), so adding a source doesn't flood you. Returns the new store items and only the genuinely new ones.
 */
export function mergeListings(items: Listing[], sourceId: string, found: Found[], now: string, baseline: boolean): { items: Listing[]; added: Listing[] } {
  const known = new Set(items.map((i) => i.id));
  const added: Listing[] = [];
  for (const f of found) {
    const id = listingId(f.url);
    if (known.has(id)) continue;
    known.add(id);
    added.push({ id, title: f.title, url: f.url, source: sourceId, found: now, fresh: !baseline });
  }
  return { items: [...added, ...items].slice(0, MAX_ITEMS), added: baseline ? [] : added };
}

export function cleanSources(raw: unknown): Source[] {
  const out: Source[] = [];
  for (const r of (Array.isArray(raw) ? raw : []).slice(0, MAX_SOURCES)) {
    const o = (r && typeof r === "object" ? r : {}) as Record<string, unknown>;
    const url = clean(o["url"], 500);
    const name = clean(o["name"], 60);
    if (!name || !/^https?:\/\//i.test(url)) continue;
    out.push({
      id: clean(o["id"], 40) || listingId(url), name, kind: o["kind"] === "rss" ? "rss" : "page", url,
      keywords: clean(o["keywords"], 200) || undefined, match: clean(o["match"], 100) || undefined, enabled: o["enabled"] !== false,
    });
  }
  return out;
}

export function cleanStore(raw: unknown): Store {
  const r = (raw && typeof raw === "object" ? raw : {}) as Record<string, unknown>;
  const sources = Array.isArray(r["sources"]) ? cleanSources(r["sources"]) : DEFAULT_SOURCES;
  const items: Listing[] = [];
  for (const i of (Array.isArray(r["items"]) ? r["items"] : []).slice(0, MAX_ITEMS)) {
    const o = (i && typeof i === "object" ? i : {}) as Record<string, unknown>;
    const url = clean(o["url"], 500), title = clean(o["title"], 200);
    if (!title || !/^https?:\/\//i.test(url)) continue;
    items.push({ id: clean(o["id"], 20) || listingId(url), title, url, source: clean(o["source"], 40), found: clean(o["found"], 30), fresh: o["fresh"] === true });
  }
  const status: Record<string, SourceStatus> = {};
  const st = (r["status"] && typeof r["status"] === "object" ? r["status"] : {}) as Record<string, unknown>;
  for (const [k, v] of Object.entries(st).slice(0, MAX_SOURCES)) {
    const o = (v && typeof v === "object" ? v : {}) as Record<string, unknown>;
    status[clean(k, 40)] = { at: clean(o["at"], 30), ok: o["ok"] === true, count: typeof o["count"] === "number" ? o["count"] : 0, error: clean(o["error"], 160) || undefined };
  }
  return { sources, items, status, lastRun: clean(r["lastRun"], 30) };
}

/** The text of a phone alert for new listings. */
export function alertText(added: Listing[], names: Record<string, string>): { title: string; body: string } {
  const lines = added.slice(0, 6).map((a) => `- ${a.title} (${names[a.source] ?? "source"})\n  ${a.url}`);
  return { title: `${added.length} new playtest${added.length === 1 ? "" : "s"} or beta${added.length === 1 ? "" : "s"}`, body: lines.join("\n") + (added.length > 6 ? `\n…and ${added.length - 6} more in Pixel Pals.` : "") };
}

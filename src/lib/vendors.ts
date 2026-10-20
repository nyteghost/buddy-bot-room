/**
 * Vendor price comparison: the pure parts (reading a price off a product page, checking links, ranking offers,
 * reading quotes the AI pulled from emails). The server file does the fetching and storing.
 */
export type OfferSource = "page" | "page-ai" | "quote" | "email";
export type Offer = {
  id: string;
  vendor: string;
  url?: string | undefined;
  /** Price per unit you'd pay, before tax (you're tax-exempt). */
  price?: number | undefined;
  shipping?: number | undefined;
  note?: string | undefined;
  source?: OfferSource | undefined;
  /** ISO date the price was read or quoted. */
  checked?: string | undefined;
  /** Why the last automatic read failed, shown so you know to type the price in. */
  error?: string | undefined;
};
export type Item = { id: string; name: string; unit?: string | undefined; offers: Offer[] };
export type Store = { items: Item[]; vendors: string[] };

/** The vendors you buy from, offered as quick picks. */
export const DEFAULT_VENDORS = ["Milspec/Gehr", "Atlantic Tape", "SICO", "Home Depot", "Lowe's", "Sunbelt Rentals", "Industrial Webbing", "Rhinos", "Amazon"];

export const MAX_ITEMS = 60;
export const MAX_OFFERS = 20;
export const STALE_DAYS = 30;

export const clean = (s: unknown, max = 120): string => (typeof s === "string" ? s.replace(/[\u0000-\u001f\u007f]/g, " ").replace(/\s+/g, " ").trim().slice(0, max) : "");
export const newId = (): string => Math.random().toString(36).slice(2, 10) + Date.now().toString(36).slice(-3);
const money = (n: unknown): number | undefined => (typeof n === "number" && Number.isFinite(n) && n >= 0 && n < 10_000_000 ? Math.round(n * 100) / 100 : undefined);

/** "$1,299.50", "1299.5 USD", "12" → number. */
export function parseMoney(text: unknown): number | undefined {
  if (typeof text === "number") return money(text);
  if (typeof text !== "string") return undefined;
  const m = text.replace(/\s/g, "").match(/(\d{1,3}(?:,\d{3})+(?:\.\d{1,2})?|\d+(?:\.\d{1,2})?)/);
  return m ? money(Number(m[1]!.replace(/,/g, ""))) : undefined;
}

/** Product pages only over http(s), and never this server's own network. */
export function safeProductUrl(raw: unknown): string | null {
  if (typeof raw !== "string") return null;
  let u: URL;
  try { u = new URL(raw.trim()); } catch { return null; }
  if (u.protocol !== "https:" && u.protocol !== "http:") return null;
  if (u.username || u.password) return null;
  const h = u.hostname.toLowerCase();
  if (!h.includes(".") || h.endsWith(".local") || h.endsWith(".internal") || h.endsWith(".lan") || h === "localhost") return null;
  if (/^\d+\.\d+\.\d+\.\d+$/.test(h)) {
    const [a, b] = h.split(".").map(Number) as [number, number];
    if (a === 10 || a === 127 || a === 0 || (a === 172 && b >= 16 && b <= 31) || (a === 192 && b === 168) || (a === 169 && b === 254) || a >= 224) return null;
  }
  if (h.includes(":") || h.startsWith("[")) return null;
  return u.toString().slice(0, 600);
}

const walk = (node: unknown, out: Record<string, unknown>[], depth = 0): void => {
  if (depth > 8 || !node) return;
  if (Array.isArray(node)) { for (const n of node.slice(0, 60)) walk(n, out, depth + 1); return; }
  if (typeof node === "object") {
    const o = node as Record<string, unknown>;
    out.push(o);
    for (const k of ["@graph", "offers", "itemListElement", "mainEntity"]) if (o[k]) walk(o[k], out, depth + 1);
  }
};

/** Reads a price from page data the shop publishes for search engines (JSON-LD, meta tags, itemprop). Null when there isn't one. */
export function extractPrice(html: string): { price: number; title?: string | undefined } | null {
  const page = html.slice(0, 1_500_000);
  const title = clean(page.match(/<meta[^>]+property=["']og:title["'][^>]*content=["']([^"']+)["']/i)?.[1] ?? page.match(/<title[^>]*>([^<]+)<\/title>/i)?.[1], 140) || undefined;

  for (const m of page.matchAll(/<script[^>]+type=["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/gi)) {
    let json: unknown;
    try { json = JSON.parse(m[1]!.trim()); } catch { continue; }
    const nodes: Record<string, unknown>[] = [];
    walk(json, nodes);
    for (const n of nodes) {
      const prices = [n["price"], n["lowPrice"]].map(parseMoney).filter((x): x is number => x !== undefined && x > 0);
      const spec = n["priceSpecification"];
      if (!prices.length && spec && typeof spec === "object") { const p = parseMoney((spec as Record<string, unknown>)["price"]); if (p) prices.push(p); }
      if (prices.length) return { price: prices[0]!, title };
    }
  }
  const metas = [
    /<meta[^>]+(?:property|name)=["'](?:product:price:amount|og:price:amount|twitter:data1)["'][^>]*content=["']([^"']+)["']/i,
    /<meta[^>]+content=["']([^"']+)["'][^>]*(?:property|name)=["'](?:product:price:amount|og:price:amount)["']/i,
    /<meta[^>]+itemprop=["']price["'][^>]*content=["']([^"']+)["']/i,
    /<[a-z]+[^>]+itemprop=["']price["'][^>]*content=["']([^"']+)["']/i,
    /class=["'][^"']*a-offscreen[^"']*["'][^>]*>\s*\$?\s*([\d,]+\.\d{2})/i,
  ];
  for (const re of metas) {
    const p = parseMoney(page.match(re)?.[1]);
    if (p && p > 0) return { price: p, title };
  }
  return null;
}

/** Visible text of a page, short enough to hand the local AI when the page has no price data. */
export function pageText(html: string, max = 5000): string {
  return html
    .replace(/<(script|style|noscript|svg|head)[\s\S]*?<\/\1>/gi, " ")
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;/g, " ").replace(/&amp;/g, "&").replace(/&#36;|&dollar;/g, "$")
    .replace(/\s+/g, " ").trim().slice(0, max);
}

const dayAge = (iso: string | undefined, now: number): number => {
  const t = iso ? Date.parse(iso) : NaN;
  return Number.isFinite(t) ? Math.floor((now - t) / 86_400_000) : Infinity;
};
export const isStale = (o: Offer, now = Date.now()): boolean => dayAge(o.checked, now) > STALE_DAYS;
export const landed = (o: Offer): number | undefined => (o.price === undefined ? undefined : Math.round((o.price + (o.shipping ?? 0)) * 100) / 100);

/** Offers with a price, cheapest first (price plus shipping). Offers without a price go last, in the order given. */
export function ranked(item: Item): Offer[] {
  const priced = item.offers.filter((o) => landed(o) !== undefined).sort((a, b) => landed(a)! - landed(b)!);
  return [...priced, ...item.offers.filter((o) => landed(o) === undefined)];
}
export const cheapest = (item: Item): Offer | null => ranked(item).find((o) => landed(o) !== undefined) ?? null;

export const sourceLabel = (o: Offer, now = Date.now()): string => {
  const age = dayAge(o.checked, now);
  const when = Number.isFinite(age) ? (age <= 0 ? "today" : `${age}d ago`) : "";
  const what = o.source === "quote" ? "quoted" : o.source === "email" ? "from email" : o.source === "page-ai" ? "AI-read from page, verify" : o.source === "page" ? "from page" : "typed in";
  return [what, when].filter(Boolean).join(" · ");
};

/** Makes whatever came back from disk or the browser safe to keep and show. */
export function cleanStore(raw: unknown): Store {
  const r = (raw && typeof raw === "object" ? raw : {}) as { items?: unknown; vendors?: unknown };
  const items: Item[] = [];
  for (const it of (Array.isArray(r.items) ? r.items : []).slice(0, MAX_ITEMS)) {
    const o = (it && typeof it === "object" ? it : {}) as Record<string, unknown>;
    const name = clean(o["name"], 100);
    if (!name) continue;
    const offers: Offer[] = [];
    for (const f of (Array.isArray(o["offers"]) ? o["offers"] : []).slice(0, MAX_OFFERS)) {
      const x = (f && typeof f === "object" ? f : {}) as Record<string, unknown>;
      const vendor = clean(x["vendor"], 60);
      if (!vendor) continue;
      const url = x["url"] === undefined || x["url"] === "" ? undefined : safeProductUrl(x["url"]) ?? undefined;
      const source = (["page", "page-ai", "quote", "email"] as const).find((s) => s === x["source"]);
      const checked = typeof x["checked"] === "string" && Number.isFinite(Date.parse(x["checked"])) ? x["checked"].slice(0, 30) : undefined;
      offers.push({
        id: clean(x["id"], 20) || newId(), vendor, url, price: money(x["price"]), shipping: money(x["shipping"]),
        note: clean(x["note"], 200) || undefined, source, checked, error: clean(x["error"], 160) || undefined,
      });
    }
    items.push({ id: clean(o["id"], 20) || newId(), name, unit: clean(o["unit"], 30) || undefined, offers });
  }
  const vendors = [...new Set((Array.isArray(r.vendors) ? r.vendors : DEFAULT_VENDORS).map((v) => clean(v, 60)).filter(Boolean))].slice(0, 40);
  return { items, vendors: vendors.length ? vendors : DEFAULT_VENDORS };
}

export type Proposed = { item: string; price: number; unit?: string | undefined; shipping?: number | undefined; note?: string | undefined };

/** The AI is asked for a JSON array of quote lines; this accepts it with or without code fences and drops anything unusable. */
export function parseAiQuotes(text: string): Proposed[] {
  const body = text.replace(/```(?:json)?/gi, "");
  const start = body.indexOf("[");
  const end = body.lastIndexOf("]");
  if (start < 0 || end <= start) return [];
  let arr: unknown;
  try { arr = JSON.parse(body.slice(start, end + 1)); } catch { return []; }
  if (!Array.isArray(arr)) return [];
  const out: Proposed[] = [];
  for (const row of arr.slice(0, 20)) {
    const o = (row && typeof row === "object" ? row : {}) as Record<string, unknown>;
    const price = parseMoney(o["price"]);
    const item = clean(o["item"], 100);
    if (!item || price === undefined || price <= 0) continue;
    out.push({ item, price, unit: clean(o["unit"], 30) || undefined, shipping: parseMoney(o["shipping"]), note: clean(o["note"], 160) || undefined });
  }
  return out;
}

/** The comparison as plain text for the AI to answer "who's cheapest?". */
export function comparisonText(items: Item[], now = Date.now()): string {
  return items.map((it) => {
    const rows = ranked(it).map((o) => `  - ${o.vendor}: ${o.price === undefined ? "no price yet" : `$${o.price.toFixed(2)}${o.shipping ? ` + $${o.shipping.toFixed(2)} shipping` : ""}`} (${sourceLabel(o, now)}${isStale(o, now) && o.price !== undefined ? ", OLD" : ""})${o.note ? ` — ${o.note}` : ""}`);
    return `${it.name}${it.unit ? ` (per ${it.unit})` : ""}:\n${rows.join("\n") || "  - no vendors yet"}`;
  }).join("\n");
}

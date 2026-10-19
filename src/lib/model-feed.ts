import { fitFor, type CatalogModel, type Fit, type TaskKey } from "./model-catalog";
import type { Hardware } from "./hardware";

/** One model from the public Ollama library listing. */
export type FeedModel = { name: string; sizes: string[]; caps: string[]; pulls: number; updated: string };

const decode = (s: string) => s.replace(/&amp;/g, "&").replace(/&#39;/g, "'").replace(/&quot;/g, '"').replace(/\s+/g, " ").trim();

/** "21.5K" → 21500, "1.2M" → 1200000. */
export function parsePulls(text: string): number {
  const m = /([\d.,]+)\s*([KMB]?)/i.exec(text.trim());
  if (!m) return 0;
  const n = Number((m[1] ?? "").replace(/,/g, ""));
  if (!Number.isFinite(n)) return 0;
  return Math.round(n * ({ "": 1, K: 1e3, M: 1e6, B: 1e9 } as Record<string, number>)[(m[2] ?? "").toUpperCase()]!);
}

/**
 * Reads the ollama.com/library listing. The page has no API, so this relies on its markup and returns
 * an empty list when the layout changes; callers then keep the built-in catalogue.
 */
export function parseLibraryPage(html: string): FeedModel[] {
  const out: FeedModel[] = [];
  const seen = new Set<string>();
  for (const block of html.split(/<li\b/i).slice(1)) {
    const href = /href="\/library\/([A-Za-z0-9][A-Za-z0-9._-]*)"/.exec(block);
    if (!href || !href[1] || seen.has(href[1])) continue;
    const grab = (attr: string) => [...block.matchAll(new RegExp(`${attr}[^>]*>\\s*([^<]+?)\\s*<`, "gi"))].map((m) => decode(m[1] ?? ""));
    const sizes = grab("x-test-size").map((s) => s.toLowerCase());
    const caps = grab("x-test-capability").map((s) => s.toLowerCase());
    seen.add(href[1]);
    out.push({ name: href[1], sizes, caps, pulls: parsePulls(grab("x-test-pull-count")[0] ?? ""), updated: grab("x-test-updated")[0] ?? "" });
  }
  return out;
}

/** Approximate 4-bit memory in GB for a size tag like "7b" or "270m". Null if it isn't a plain parameter count. */
export function sizeToGb(size: string): number | null {
  const m = /^(\d+(?:\.\d+)?)\s*([bm])$/i.exec(size.trim());
  if (!m) return null;
  const params = Number(m[1]) / (m[2]!.toLowerCase() === "m" ? 1000 : 1);
  return Math.round((params * 0.62 + 0.3) * 10) / 10;
}

export const MIN_PULLS = 10_000;

/** Turns library entries into pullable suggestions. Skips embedding, cloud-only and audio/vision-only models and ones few people use. */
export function feedToCatalog(feed: FeedModel[], minPulls = MIN_PULLS): (CatalogModel & { isNew: true; updated: string })[] {
  const out: (CatalogModel & { isNew: true; updated: string })[] = [];
  for (const m of feed) {
    if (m.pulls < minPulls || m.caps.some((c) => c === "embedding" || c === "cloud" || c === "audio")) continue;
    if (m.caps.includes("vision") && !m.caps.includes("tools") && !m.caps.includes("thinking")) continue;
    const task: TaskKey = /code/i.test(m.name) ? "code" : m.caps.includes("thinking") ? "reasoning" : "chat";
    for (const size of m.sizes) {
      const gb = sizeToGb(size);
      if (gb === null) continue;
      out.push({ id: `${m.name}:${size}`, task: gb <= 2.5 && task === "chat" ? "fast" : task, gb, note: `New on Ollama${m.updated ? ` · updated ${m.updated}` : ""}`, isNew: true, updated: m.updated });
    }
  }
  return out;
}

/** For each task, the largest new model that fits this machine, newest listings first. At most `limit` overall. */
export function newSuggestions(feed: FeedModel[], hw: Hardware, installed: Set<string>, known: Set<string>, limit = 6): { model: CatalogModel & { updated: string }; fit: Fit }[] {
  const picked: { model: CatalogModel & { updated: string }; fit: Fit }[] = [];
  const perFamily = new Set<string>();
  for (const name of feed.map((m) => m.name)) {
    const entries = feedToCatalog(feed.filter((m) => m.name === name))
      .filter((c) => !installed.has(c.id) && !known.has(c.id) && fitFor(c, hw) !== "no")
      .sort((a, b) => b.gb - a.gb);
    const preferGpu = entries.find((c) => fitFor(c, hw) === "gpu") ?? entries[0];
    if (preferGpu && !perFamily.has(name)) {
      perFamily.add(name);
      picked.push({ model: preferGpu, fit: fitFor(preferGpu, hw) });
    }
    if (picked.length >= limit) break;
  }
  return picked;
}

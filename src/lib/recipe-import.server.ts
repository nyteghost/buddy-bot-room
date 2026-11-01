import { lookup } from "node:dns/promises";
import { request } from "node:https";
import { recipeUrl, validRecipe, type FoodRecipe } from "./focus-food";
export function publicRecipeAddress(address: string): boolean {
  if (!/^\d+\.\d+\.\d+\.\d+$/.test(address)) return false;
  const [a = 0, b = 0, c = 0] = address.split(".").map(Number);
  if (address.split(".").some(n => +n > 255)) return false;
  return !(a === 0 || a === 10 || a === 127 || a >= 224 || (a === 100 && b >= 64 && b <= 127) || (a === 169 && b === 254) || (a === 172 && b >= 16 && b <= 31) || (a === 192 && (b === 168 || b === 0 || (b === 88 && c === 99))) || (a === 198 && (b === 18 || b === 19 || (b === 51 && c === 100))) || (a === 203 && b === 0 && c === 113));
}
/** Resolve once and pin the validated address to the socket; check every redirect separately. */
export async function recipePage(raw: string, signal: AbortSignal): Promise<{ html: string; source: string }> {
  let url = recipeUrl(raw);
  if (!url) throw new Error("Use a public HTTPS recipe link, or paste the recipe text.");
  for (let hop = 0; hop < 4; hop++) {
    signal.throwIfAborted();
    let abortLookup: () => void = () => {};
    const addresses = await Promise.race([lookup(url.hostname, { all: true, family: 4 }), new Promise<never>((_, reject) => { abortLookup = () => reject(new Error("Import cancelled or timed out")); signal.addEventListener("abort", abortLookup, { once: true }); })]).finally(() => signal.removeEventListener("abort", abortLookup));
    signal.throwIfAborted();
    if (!addresses.length || addresses.some(x => !publicRecipeAddress(x.address))) throw new Error("That link is not a public recipe website. Paste the recipe text instead.");
    const pinned = addresses[0]!;
    const socketUrl = new URL(url); socketUrl.hostname = pinned.address;
    const result = await new Promise<{ html: string; location: string | null }>((resolve, reject) => {
      const req = request(socketUrl, { method: "GET", servername: url!.hostname, rejectUnauthorized: true, family: 4, agent: false, signal, headers: { Host: url!.host, Accept: "text/html", "Accept-Encoding": "identity", "User-Agent": "PixelPals-RecipeImport/1.0" } }, res => {
        const status = res.statusCode ?? 0;
        if ([301, 302, 303, 307, 308].includes(status)) { res.destroy(); resolve({ html: "", location: res.headers.location ?? "" }); return; }
        if (status !== 200 || !/^text\/html\b/i.test(res.headers["content-type"] ?? "") || (res.headers["content-encoding"] && res.headers["content-encoding"] !== "identity")) { res.destroy(); reject(new Error("This site could not provide a readable recipe. Paste the text instead.")); return; }
        const chunks: Buffer[] = []; let size = 0;
        res.on("data", (chunk: Buffer) => { size += chunk.length; if (size > 1_500_000) { res.destroy(); reject(new Error("This page is too large. Paste the recipe text instead.")); } else chunks.push(chunk); });
        res.on("error", reject); res.on("aborted", () => reject(new Error("Recipe download interrupted")));
        res.on("end", () => resolve({ html: Buffer.concat(chunks).toString("utf8"), location: null }));
      });
      req.setTimeout(10000, () => req.destroy(new Error("Recipe website timed out")));
      req.on("error", reject); req.end();
    });
    if (result.location === null) return { html: result.html, source: url.toString() };
    if (!result.location) throw new Error("The recipe site returned an invalid redirect.");
    url = recipeUrl(new URL(result.location, url).toString());
    if (!url) throw new Error("The recipe redirect is not a public HTTPS link.");
  }
  throw new Error("Too many redirects. Paste the recipe text instead.");
}
function plain(v: unknown): string {
  if (typeof v !== "string") return "";
  return v.replace(/<br\s*\/?\s*>|<\/(?:p|li|div)>/gi, "\n").replace(/<[^>]*>/g, "").replace(/&#(x[0-9a-f]+|\d+);/gi, (_, n: string) => { const c = n[0]?.toLowerCase() === "x" ? parseInt(n.slice(1), 16) : +n; return c > 0 && c <= 0x10ffff ? String.fromCodePoint(c) : ""; }).replace(/&(amp|quot|apos|lt|gt|nbsp);/g, (_, n: string) => ({ amp: "&", quot: '"', apos: "'", lt: "<", gt: ">", nbsp: " " })[n] ?? "").trim();
}
export function extractRecipe(html: string, source: string): FoodRecipe | null {
  if (html.length > 1_500_000) return null;
  let budget = 3000;
  const instructions = (v: unknown, depth = 0): string[] => {
    if (depth > 12 || --budget < 0) return [];
    if (typeof v === "string") { const text = plain(v); return text ? [text] : []; }
    if (Array.isArray(v)) return v.flatMap(x => instructions(x, depth + 1));
    if (!v || typeof v !== "object") return [];
    const obj = v as Record<string, unknown>;
    if (obj["itemListElement"]) return instructions(obj["itemListElement"], depth + 1);
    return instructions(obj["text"] ?? obj["name"], depth + 1);
  };
  const visit = (v: unknown, depth = 0): FoodRecipe | null => {
    if (depth > 12 || --budget < 0 || !v || typeof v !== "object") return null;
    if (Array.isArray(v)) { for (const item of v) { const r = visit(item, depth + 1); if (r) return r; } return null; }
    const o = v as Record<string, unknown>, types = Array.isArray(o["@type"]) ? o["@type"] : [o["@type"]];
    if (types.some(t => typeof t === "string" && /(?:^|[/#])Recipe$/.test(t))) {
      const nutrition = o["nutrition"] as Record<string, unknown> | undefined;
      return validRecipe({ title: plain(o["name"]), ingredients: instructions(o["recipeIngredient"]), steps: instructions(o["recipeInstructions"]), servings: plain(Array.isArray(o["recipeYield"]) ? o["recipeYield"].join(" / ") : String(o["recipeYield"] ?? "")), source, nutrition: nutrition ? Object.entries(nutrition).filter(([k, v]) => !k.startsWith("@") && typeof v === "string").map(([k, v]) => `${k}: ${plain(v)}`).join(" · ") : "" });
    }
    for (const item of Object.values(o)) { const r = visit(item, depth + 1); if (r) return r; } return null;
  };
  for (const match of html.matchAll(/<script\b[^>]*\btype\s*=\s*["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script\s*>/gi)) {
    try { const r = visit(JSON.parse(match[1]!)); if (r) return r; } catch { /* A malformed block must not hide another recipe block. */ }
  }
  return null;
}

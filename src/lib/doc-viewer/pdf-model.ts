// Pure helpers for the PDF viewer (no pdfjs, no DOM), so the page maths, zoom and search can be unit tested.

export const PDF_MAX_BYTES = 40_000_000;
export const PDF_PRINT_PAGES = 300;
export const ZOOM_STEPS = [0.25, 0.5, 0.75, 1, 1.25, 1.5, 2, 3, 4] as const;
export const MIN_ZOOM = ZOOM_STEPS[0];
export const MAX_ZOOM = ZOOM_STEPS[ZOOM_STEPS.length - 1]!;

export type ZoomMode = "width" | "page" | "custom";
export type Size = { w: number; h: number };

export const clampZoom = (z: number): number => (Number.isFinite(z) ? Math.min(MAX_ZOOM, Math.max(MIN_ZOOM, z)) : 1);
export const zoomIn = (z: number): number => ZOOM_STEPS.find((s) => s > z + 0.001) ?? MAX_ZOOM;
export const zoomOut = (z: number): number => [...ZOOM_STEPS].reverse().find((s) => s < z - 0.001) ?? MIN_ZOOM;
export const clampPage = (page: number, pages: number): number => (pages < 1 ? 1 : Math.min(pages, Math.max(1, Math.round(Number.isFinite(page) ? page : 1))));

/** The scale to draw pages at. "width" fits the page width to the box, "page" fits the whole first page, "custom" uses the zoom as given. */
export function fitScale(mode: ZoomMode, zoom: number, page: Size, box: Size, pad = 24): number {
  if (mode === "custom" || page.w <= 0 || page.h <= 0) return clampZoom(zoom);
  const byWidth = (box.w - pad) / page.w;
  const raw = mode === "width" ? byWidth : Math.min(byWidth, (box.h - pad) / page.h);
  return Number.isFinite(raw) && raw > 0 ? Math.min(MAX_ZOOM, Math.max(0.1, raw)) : 1;
}

export type PageLayout = { tops: number[]; heights: number[]; widths: number[]; total: number };
/** Where every page sits in the scrolling column. Pages whose size isn't known yet use the fallback size. */
export function layoutPages(count: number, sizes: ReadonlyMap<number, Size>, fallback: Size, scale: number, gap = 12): PageLayout {
  const tops: number[] = []; const heights: number[] = []; const widths: number[] = [];
  let y = gap;
  for (let i = 1; i <= count; i++) {
    const s = sizes.get(i) ?? fallback;
    const h = Math.max(1, Math.round(s.h * scale)); const w = Math.max(1, Math.round(s.w * scale));
    tops.push(y); heights.push(h); widths.push(w);
    y += h + gap;
  }
  return { tops, heights, widths, total: y };
}

/** Which pages to draw: those touching the viewport plus a buffer, and the page that counts as "current" (the one under the top third of the view). */
export function visiblePages(layout: PageLayout, scrollTop: number, viewH: number, bufferPx = viewH): { first: number; last: number; current: number } {
  const n = layout.tops.length;
  if (!n) return { first: 1, last: 0, current: 1 };
  const lo = scrollTop - bufferPx; const hi = scrollTop + viewH + bufferPx;
  let first = n; let last = 1;
  for (let i = 0; i < n; i++) {
    const top = layout.tops[i]!; const bottom = top + layout.heights[i]!;
    if (bottom >= lo && top <= hi) { first = Math.min(first, i + 1); last = Math.max(last, i + 1); }
  }
  if (first > last) { first = last = n; }
  const probe = scrollTop + viewH / 3;
  let current = 1;
  for (let i = 0; i < n; i++) if (layout.tops[i]! <= probe) current = i + 1;
  return { first, last, current };
}

/** The pages to draw: those in the window, but never more than `limit`, preferring the ones closest to `center`, so memory stays bounded however far out you zoom. */
export function pagesToRender(first: number, last: number, count: number, center: number, limit = 9): number[] {
  const all: number[] = [];
  for (let p = Math.max(1, first); p <= Math.min(count, last); p++) all.push(p);
  if (all.length <= limit) return all;
  return all.sort((a, b) => Math.abs(a - center) - Math.abs(b - center) || a - b).slice(0, limit).sort((a, b) => a - b);
}

export type Match = { page: number; start: number; length: number };
const squash = (s: string) => s.replace(/\s+/g, " ").toLowerCase();

/** Every place the query occurs in the page texts (case-insensitive, whitespace-insensitive). Pages not yet read are skipped. */
export function findMatches(pageTexts: ReadonlyArray<string | undefined>, query: string, max = 2000): Match[] {
  const q = squash(query).trim();
  if (!q) return [];
  const out: Match[] = [];
  for (let i = 0; i < pageTexts.length; i++) {
    const t = pageTexts[i];
    if (!t) continue;
    const hay = squash(t);
    for (let at = hay.indexOf(q); at >= 0; at = hay.indexOf(q, at + q.length)) {
      out.push({ page: i + 1, start: at, length: q.length });
      if (out.length >= max) return out;
    }
  }
  return out;
}
export const stepIndex = (i: number, total: number, dir: 1 | -1): number => (total < 1 ? -1 : i < 0 ? (dir === 1 ? 0 : total - 1) : (i + dir + total) % total);

/** The indexes of text items (as pdf.js returns them) that take part in a match, so the text layer can highlight them. Works for phrases that span items. */
export function matchingItems(items: readonly string[], query: string): Set<number> {
  const q = squash(query).trim();
  const hits = new Set<number>();
  if (!q) return hits;
  let joined = ""; const starts: number[] = []; const ends: number[] = [];
  items.forEach((raw, i) => { const t = squash(raw); starts[i] = joined.length; joined += t; ends[i] = joined.length; if (t && !t.endsWith(" ")) joined += " "; });
  for (let at = joined.indexOf(q); at >= 0; at = joined.indexOf(q, at + q.length)) {
    const stop = at + q.length;
    for (let i = 0; i < items.length; i++) if (ends[i]! > starts[i]! && starts[i]! < stop && ends[i]! > at) hits.add(i);
  }
  return hits;
}

/** Page numbers to print, capped so a huge document can't exhaust memory. */
export const printablePages = (count: number, limit = PDF_PRINT_PAGES): number[] => Array.from({ length: Math.min(count, limit) }, (_, i) => i + 1);

/** Plain words for the errors a PDF can raise. Nothing from the file itself is shown. */
export function pdfErrorMessage(e: unknown): string {
  const name = e instanceof Error ? (e as Error & { name?: string }).name : "";
  const msg = e instanceof Error ? e.message : "";
  if (/password/i.test(name) || /password/i.test(msg)) return "This PDF is password-protected. Remove the password in another app, then open it again.";
  if (/invalid|missing pdf|unexpected server|format/i.test(`${name} ${msg}`)) return "This file isn't a readable PDF.";
  if (/abort|cancel/i.test(`${name} ${msg}`)) return "Cancelled.";
  return "Couldn't open this PDF.";
}

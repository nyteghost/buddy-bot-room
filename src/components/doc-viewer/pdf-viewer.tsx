import { memo, useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { ArrowLeftRight, ChevronDown, ChevronUp, Download, Expand, Loader2, Maximize2, Minimize2, PanelLeft, Printer, Search, X, ZoomIn, ZoomOut } from "lucide-react";
import { Input } from "@/components/ui/input";
import { openPdf } from "@/lib/doc-viewer/pdfjs-loader";
import { clampPage, fitScale, findMatches, layoutPages, matchingItems, pagesToRender, pdfErrorMessage, printablePages, stepIndex, visiblePages, zoomIn, zoomOut, type Match, type Size, type ZoomMode } from "@/lib/doc-viewer/pdf-model";
import { cn } from "@/lib/utils";
import { Divider, ToolButton, ViewerToolbar } from "./toolbar";

/* eslint-disable @typescript-eslint/no-explicit-any -- pdf.js objects are used through a small, local surface */
type PdfDoc = any;
type PdfJs = any;
const FALLBACK: Size = { w: 612, h: 792 };
const KEEP_PAGES = 9;

function canvasScale(w: number, h: number): number {
  // Never ask for a canvas bigger than ~16 megapixels, however far the user zooms.
  const dpr = Math.min(window.devicePixelRatio || 1, 2);
  return Math.min(dpr, Math.sqrt(16_000_000 / Math.max(1, w * h)));
}

type PageProps = { doc: PdfDoc; pdfjs: PdfJs; n: number; scale: number; query: string; onSize: (n: number, s: Size) => void; width: number; height: number };

/** One page: a canvas plus a transparent text layer (for selecting and searching). Only mounted while near the viewport, so leaving it frees the pixels. */
const PdfPage = memo(function PdfPage({ doc, pdfjs, n, scale, query, onSize, width, height }: PageProps) {
  const canvas = useRef<HTMLCanvasElement>(null);
  const text = useRef<HTMLDivElement>(null);
  const [drawn, setDrawn] = useState(0);
  useEffect(() => {
    const cv = canvas.current; const tl = text.current;
    if (!cv || !tl) return;
    let cancelled = false;
    let task: { cancel: () => void; promise: Promise<unknown> } | null = null;
    let layer: { cancel?: () => void } | null = null;
    (async () => {
      const page = await doc.getPage(n);
      if (cancelled) return;
      const natural = page.getViewport({ scale: 1 });
      onSize(n, { w: natural.width, h: natural.height });
      const viewport = page.getViewport({ scale });
      const ratio = canvasScale(viewport.width, viewport.height);
      const off = document.createElement("canvas"); // draw off-screen, then swap in, so a re-render never flashes blank
      off.width = Math.max(1, Math.floor(viewport.width * ratio)); off.height = Math.max(1, Math.floor(viewport.height * ratio));
      const ctx = off.getContext("2d", { alpha: false });
      if (!ctx) return;
      ctx.fillStyle = "#fff"; ctx.fillRect(0, 0, off.width, off.height);
      task = page.render({ canvasContext: ctx, viewport, transform: ratio !== 1 ? [ratio, 0, 0, ratio, 0, 0] : undefined });
      await task!.promise;
      if (cancelled) return;
      cv.width = off.width; cv.height = off.height;
      cv.getContext("2d")?.drawImage(off, 0, 0);
      cv.style.width = `${viewport.width}px`; cv.style.height = `${viewport.height}px`;
      tl.replaceChildren();
      tl.style.setProperty("--scale-factor", String(scale)); tl.style.setProperty("--total-scale-factor", String(scale)); tl.style.setProperty("--user-unit", "1");
      const layerObj = new pdfjs.TextLayer({ textContentSource: page.streamTextContent(), container: tl, viewport });
      layer = layerObj;
      await layerObj.render();
      if (cancelled) return;
      (tl as any).__items = { divs: layerObj.textDivs as HTMLElement[], strs: layerObj.textContentItemsStr as string[] };
      setDrawn((v) => v + 1);
      page.cleanup();
    })().catch((e) => { if (!cancelled && !/cancel/i.test(String((e as Error)?.name ?? e))) console.warn("PDF page", n, "failed to draw"); });
    return () => { cancelled = true; try { task?.cancel(); } catch { /* already done */ } try { layer?.cancel?.(); } catch { /* already done */ } };
  }, [doc, pdfjs, n, scale, onSize]);

  // Highlight the text pieces that match the search.
  useEffect(() => {
    const items = (text.current as any)?.__items as { divs: HTMLElement[]; strs: string[] } | undefined;
    if (!items) return;
    const hits = query.trim() ? matchingItems(items.strs, query) : new Set<number>();
    items.divs.forEach((d, i) => d.classList.toggle("pp-hit", hits.has(i)));
  }, [query, drawn]);

  return (
    <div className="relative bg-white shadow-md" style={{ width, height }} data-page={n}>
      <canvas ref={canvas} className="block" aria-label={`Page ${n}`} />
      <div ref={text} className="pp-textlayer" />
    </div>
  );
});

function Thumb({ doc, n, size, active, onGo }: { doc: PdfDoc; n: number; size: Size; active: boolean; onGo: (n: number) => void }) {
  const ref = useRef<HTMLCanvasElement>(null);
  const box = useRef<HTMLButtonElement>(null);
  const [near, setNear] = useState(false);
  const W = 96; const H = Math.round((W * size.h) / size.w);
  useEffect(() => {
    const el = box.current; if (!el) return;
    const io = new IntersectionObserver(([e]) => setNear(!!e?.isIntersecting), { rootMargin: "300px" });
    io.observe(el);
    return () => io.disconnect();
  }, []);
  useEffect(() => {
    const cv = ref.current; if (!cv) return;
    if (!near) { cv.width = 0; cv.height = 0; return; }
    let cancelled = false; let task: { cancel: () => void; promise: Promise<unknown> } | null = null;
    (async () => {
      const page = await doc.getPage(n);
      const nat = page.getViewport({ scale: 1 });
      const vp = page.getViewport({ scale: W / nat.width });
      if (cancelled) return;
      cv.width = Math.floor(vp.width); cv.height = Math.floor(vp.height);
      const ctx = cv.getContext("2d", { alpha: false }); if (!ctx) return;
      task = page.render({ canvasContext: ctx, viewport: vp });
      await task!.promise; page.cleanup();
    })().catch(() => undefined);
    return () => { cancelled = true; try { task?.cancel(); } catch { /* done */ } };
  }, [doc, n, near]);
  return (
    <button ref={box} type="button" onClick={() => onGo(n)} aria-label={`Go to page ${n}`} aria-current={active ? "page" : undefined}
      className={cn("mx-auto flex flex-col items-center gap-0.5 rounded p-1 hover:bg-accent/50", active && "bg-accent")}>
      <span className="block bg-white shadow" style={{ width: W, height: H }}><canvas ref={ref} style={{ width: W, height: H }} /></span>
      <span className="text-[10px] text-muted-foreground">{n}</span>
    </button>
  );
}

export function PdfViewer({ buffer, name, onDownload, className }: { buffer: ArrayBuffer; name: string; onDownload?: () => void; className?: string }) {
  const root = useRef<HTMLDivElement>(null);
  const scroller = useRef<HTMLDivElement>(null);
  const [state, setState] = useState<{ doc: PdfDoc; pdfjs: PdfJs; pages: number } | null>(null);
  const [error, setError] = useState("");
  const [sizes, setSizes] = useState<Map<number, Size>>(() => new Map());
  const [mode, setMode] = useState<ZoomMode>("width");
  const [zoom, setZoom] = useState(1);
  const [box, setBox] = useState<Size>({ w: 800, h: 600 });
  const [scrollTop, setScrollTop] = useState(0);
  const [thumbs, setThumbs] = useState(false);
  const [full, setFull] = useState(false);
  const [searchOpen, setSearchOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [texts, setTexts] = useState<(string | undefined)[]>([]);
  const [progress, setProgress] = useState<{ done: number; total: number } | null>(null);
  const [matchIdx, setMatchIdx] = useState(-1);
  const [pageInput, setPageInput] = useState("1");
  const [printing, setPrinting] = useState<string>("");
  const textsRef = useRef<(string | undefined)[]>([]);
  const readingRef = useRef(0);

  // Open the document; close it (and stop its worker) when the viewer goes away or another file is chosen.
  useEffect(() => {
    let cancelled = false; let opened: { task: { destroy: () => Promise<void> } } | null = null;
    setState(null); setError(""); setSizes(new Map()); setTexts([]); textsRef.current = []; setMatchIdx(-1); setScrollTop(0);
    openPdf(buffer).then((o) => { if (cancelled) { void o.task.destroy(); return; } opened = o; setState({ doc: o.doc, pdfjs: o.pdfjs, pages: o.doc.numPages }); })
      .catch((e) => { if (!cancelled) setError(pdfErrorMessage(e)); });
    return () => { cancelled = true; readingRef.current++; void opened?.task.destroy(); };
  }, [buffer]);

  useEffect(() => {
    const el = scroller.current; if (!el) return;
    const ro = new ResizeObserver(() => setBox({ w: el.clientWidth, h: el.clientHeight }));
    ro.observe(el); setBox({ w: el.clientWidth, h: el.clientHeight });
    return () => ro.disconnect();
  }, [state]);
  useEffect(() => {
    const on = () => setFull(document.fullscreenElement === root.current);
    document.addEventListener("fullscreenchange", on);
    return () => document.removeEventListener("fullscreenchange", on);
  }, []);

  const first = sizes.get(1) ?? FALLBACK;
  const scale = fitScale(mode, zoom, first, box);
  const pages = state?.pages ?? 0;
  const layout = useMemo(() => layoutPages(pages, sizes, first, scale), [pages, sizes, first, scale]);
  const vis = useMemo(() => visiblePages(layout, scrollTop, box.h), [layout, scrollTop, box.h]);
  const render = useMemo(() => pagesToRender(vis.first, vis.last, pages, vis.current, KEEP_PAGES), [vis.first, vis.last, pages, vis.current]);
  const maxW = Math.max(0, ...layout.widths);
  useEffect(() => setPageInput(String(vis.current)), [vis.current]);

  // Keep the same spot on screen when the scale changes.
  const anchor = useRef({ page: 1, frac: 0 });
  useEffect(() => { const h = layout.heights[vis.current - 1] ?? 1; anchor.current = { page: vis.current, frac: Math.min(1, Math.max(0, (scrollTop - (layout.tops[vis.current - 1] ?? 0)) / h)) }; }, [scrollTop, vis.current, layout]);
  const lastScale = useRef(scale);
  useLayoutEffect(() => {
    if (lastScale.current === scale) return;
    lastScale.current = scale;
    const el = scroller.current; if (!el) return;
    const a = anchor.current;
    el.scrollTop = (layout.tops[a.page - 1] ?? 0) + a.frac * (layout.heights[a.page - 1] ?? 0);
  }, [scale, layout]);

  const onSize = useCallback((n: number, s: Size) => setSizes((m) => { const o = m.get(n); if (o && Math.abs(o.w - s.w) < 0.5 && Math.abs(o.h - s.h) < 0.5) return m; const next = new Map(m); next.set(n, s); return next; }), []);
  const raf = useRef(0);
  const onScroll = () => { if (raf.current) return; raf.current = requestAnimationFrame(() => { raf.current = 0; setScrollTop(scroller.current?.scrollTop ?? 0); }); };
  const goTo = useCallback((p: number) => {
    const n = clampPage(p, pages); const el = scroller.current; if (!el) return;
    el.scrollTo({ top: Math.max(0, (layout.tops[n - 1] ?? 0) - 8) });
  }, [pages, layout]);

  // ---- search: read the text of each page once (cancellable), then look through it ----
  const readAll = useCallback(async () => {
    if (!state) return;
    const token = ++readingRef.current;
    const { doc } = state;
    setProgress({ done: textsRef.current.filter((t) => t !== undefined).length, total: doc.numPages });
    for (let p = 1; p <= doc.numPages; p++) {
      if (readingRef.current !== token) return;
      if (textsRef.current[p - 1] !== undefined) continue;
      try {
        const page = await doc.getPage(p);
        const content = await page.getTextContent();
        textsRef.current[p - 1] = (content.items as { str?: string }[]).map((i) => i.str ?? "").join(" ");
        page.cleanup();
      } catch { textsRef.current[p - 1] = ""; }
      if (p % 8 === 0 || p === doc.numPages) { setTexts([...textsRef.current]); setProgress({ done: p, total: doc.numPages }); await new Promise((r) => setTimeout(r, 0)); }
    }
    setTexts([...textsRef.current]); setProgress(null);
  }, [state]);
  const matches: Match[] = useMemo(() => findMatches(texts, query), [texts, query]);
  useEffect(() => { setMatchIdx(matches.length ? 0 : -1); }, [query]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => { if (matchIdx >= 0 && matches[matchIdx]) goTo(matches[matchIdx]!.page); }, [matchIdx]); // eslint-disable-line react-hooks/exhaustive-deps
  const openSearch = () => { setSearchOpen(true); if (!progress && texts.filter((t) => t !== undefined).length < pages) void readAll(); };
  const step = (dir: 1 | -1) => setMatchIdx((i) => stepIndex(Math.min(i, matches.length - 1), matches.length, dir));

  // ---- print: draw pages into images in a temporary print-only layer ----
  const print = async () => {
    if (!state || printing) return;
    const { doc } = state;
    const layer = document.createElement("div"); layer.className = "pp-print-root";
    document.body.appendChild(layer);
    const urls: string[] = [];
    try {
      const list = printablePages(doc.numPages);
      for (const p of list) {
        setPrinting(`Preparing page ${p} of ${list.length}…`);
        const page = await doc.getPage(p);
        const vp = page.getViewport({ scale: 1.6 });
        const cv = document.createElement("canvas"); cv.width = Math.floor(vp.width); cv.height = Math.floor(vp.height);
        const ctx = cv.getContext("2d", { alpha: false }); if (!ctx) continue;
        ctx.fillStyle = "#fff"; ctx.fillRect(0, 0, cv.width, cv.height);
        await page.render({ canvasContext: ctx, viewport: vp }).promise;
        const blob = await new Promise<Blob | null>((r) => cv.toBlob(r, "image/jpeg", 0.88));
        page.cleanup(); cv.width = 0; cv.height = 0;
        if (!blob) continue;
        const url = URL.createObjectURL(blob); urls.push(url);
        const img = document.createElement("img"); img.src = url; img.alt = ""; layer.appendChild(img);
      }
      setPrinting("");
      const done = () => { layer.remove(); urls.forEach((u) => URL.revokeObjectURL(u)); window.removeEventListener("afterprint", done); };
      window.addEventListener("afterprint", done);
      window.print();
      setTimeout(done, 120_000);
    } catch { layer.remove(); urls.forEach((u) => URL.revokeObjectURL(u)); setPrinting(""); }
  };

  const toggleFull = () => { if (document.fullscreenElement) void document.exitFullscreen(); else void root.current?.requestFullscreen?.().catch(() => undefined); };
  const onKey = (e: React.KeyboardEvent) => {
    if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "f") { e.preventDefault(); openSearch(); }
    else if (e.key === "Escape" && searchOpen) setSearchOpen(false);
    else if ((e.ctrlKey || e.metaKey) && (e.key === "+" || e.key === "=")) { e.preventDefault(); setMode("custom"); setZoom(zoomIn(scale)); }
    else if ((e.ctrlKey || e.metaKey) && e.key === "-") { e.preventDefault(); setMode("custom"); setZoom(zoomOut(scale)); }
  };

  if (error) return <div role="alert" className="p-6 text-sm text-destructive">{error}</div>;
  if (!state) return <div className="flex items-center gap-2 p-6 text-sm text-muted-foreground"><Loader2 className="size-4 animate-spin" /> Opening {name}…</div>;

  return (
    <div ref={root} tabIndex={-1} onKeyDown={onKey} className={cn("flex h-full min-h-0 flex-col bg-background outline-none", className)}>
      <ViewerToolbar>
        <ToolButton label="Page thumbnails" active={thumbs} onClick={() => setThumbs((v) => !v)}><PanelLeft className="size-4" /></ToolButton>
        <ToolButton label="Previous page" disabled={vis.current <= 1} onClick={() => goTo(vis.current - 1)}><ChevronUp className="size-4" /></ToolButton>
        <ToolButton label="Next page" disabled={vis.current >= pages} onClick={() => goTo(vis.current + 1)}><ChevronDown className="size-4" /></ToolButton>
        <form className="flex items-center gap-1 text-xs" onSubmit={(e) => { e.preventDefault(); goTo(Number(pageInput)); }}>
          <Input aria-label="Page number" inputMode="numeric" className="h-8 w-14 px-2 text-center" value={pageInput} onChange={(e) => setPageInput(e.target.value.replace(/\D/g, "").slice(0, 5))} onBlur={() => setPageInput(String(vis.current))} />
          <span className="text-muted-foreground">of {pages}</span>
        </form>
        <Divider />
        <ToolButton label="Zoom out" onClick={() => { setMode("custom"); setZoom(zoomOut(scale)); }}><ZoomOut className="size-4" /></ToolButton>
        <span className="w-12 text-center text-xs tabular-nums" aria-live="polite">{Math.round(scale * 100)}%</span>
        <ToolButton label="Zoom in" onClick={() => { setMode("custom"); setZoom(zoomIn(scale)); }}><ZoomIn className="size-4" /></ToolButton>
        <ToolButton label="Fit width" active={mode === "width"} onClick={() => setMode("width")}><ArrowLeftRight className="size-4" /></ToolButton>
        <ToolButton label="Fit page" active={mode === "page"} onClick={() => setMode("page")}><Expand className="size-4" /></ToolButton>
        <Divider />
        <ToolButton label="Search in document" active={searchOpen} onClick={() => (searchOpen ? setSearchOpen(false) : openSearch())}><Search className="size-4" /></ToolButton>
        <ToolButton label="Print" disabled={!!printing} onClick={() => void print()}><Printer className="size-4" /></ToolButton>
        {onDownload && <ToolButton label="Download" onClick={onDownload}><Download className="size-4" /></ToolButton>}
        <ToolButton label={full ? "Exit full screen" : "Full screen"} onClick={toggleFull}>{full ? <Minimize2 className="size-4" /> : <Maximize2 className="size-4" />}</ToolButton>
        {printing && <span className="ml-1 text-xs text-muted-foreground" role="status">{printing}</span>}
      </ViewerToolbar>
      {searchOpen && (
        <div className="flex flex-wrap items-center gap-2 border-b bg-muted/30 px-2 py-1">
          <Input autoFocus aria-label="Search the document" placeholder="Find in this PDF" className="h-8 max-w-64" value={query} onChange={(e) => setQuery(e.target.value)}
            onKeyDown={(e) => { if (e.key === "Enter") { e.preventDefault(); step(e.shiftKey ? -1 : 1); } }} />
          <ToolButton label="Previous match" disabled={!matches.length} onClick={() => step(-1)}><ChevronUp className="size-4" /></ToolButton>
          <ToolButton label="Next match" disabled={!matches.length} onClick={() => step(1)}><ChevronDown className="size-4" /></ToolButton>
          <span className="text-xs text-muted-foreground" role="status">
            {!query.trim() ? "" : matches.length ? `${matchIdx + 1} of ${matches.length}${matches.length >= 2000 ? "+" : ""}` : progress ? "No matches yet" : "No matches"}
            {progress ? ` · reading page ${progress.done} of ${progress.total}` : ""}
          </span>
          <ToolButton label="Close search" onClick={() => setSearchOpen(false)}><X className="size-4" /></ToolButton>
        </div>
      )}
      <div className="flex min-h-0 flex-1">
        {thumbs && (
          <div className="w-28 shrink-0 overflow-y-auto border-r bg-muted/20 py-1" aria-label="Page thumbnails">
            {Array.from({ length: pages }, (_, i) => <Thumb key={i} doc={state.doc} n={i + 1} size={sizes.get(i + 1) ?? first} active={vis.current === i + 1} onGo={goTo} />)}
          </div>
        )}
        <div ref={scroller} onScroll={onScroll} className="relative min-w-0 flex-1 overflow-auto bg-muted/40" data-testid="pdf-scroller">
          <div className="relative" style={{ height: layout.total, width: Math.max(box.w, maxW + 24), minWidth: "100%" }}>
            {render.map((n) => (
              <div key={n} className="absolute left-0 right-0 flex justify-center" style={{ top: layout.tops[n - 1], height: layout.heights[n - 1] }}>
                <PdfPage doc={state.doc} pdfjs={state.pdfjs} n={n} scale={scale} query={searchOpen ? query : ""} onSize={onSize} width={layout.widths[n - 1] ?? 0} height={layout.heights[n - 1] ?? 0} />
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}

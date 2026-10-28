import { useCallback, useEffect, useMemo, useRef, useState, type CSSProperties, type ReactNode } from "react";
import { ChevronDown, ChevronUp, Download, Maximize2, Minimize2, Search, X } from "lucide-react";
import { Input } from "@/components/ui/input";
import { DEFAULT_COL_W, DEFAULT_ROW_H, buildOffsets, cellAt, cellKey, colName, describeSheet, indexMerges, nextHitIndex, parseRef, rangeFor, refOf, searchSheet, type Cell, type Hit, type Merge, type SheetData, type Workbook } from "@/lib/doc-viewer/sheet-model";
import { cn } from "@/lib/utils";
import { Divider, ToolButton, ViewerToolbar } from "./toolbar";

const HDR = 24;      // column header height
const RH = 46;       // row header width
const OVERSCAN = 3;

type Pos = { r: number; c: number };

/** Read-only grid. Only the rows and columns in (or near) view are drawn, so a sheet with 50,000 rows scrolls as smoothly as one with 50. */
function Grid({ sheet, selected, onSelect, hits, hit, scrollTo, onScrolled }: {
  sheet: SheetData; selected: Pos | null; onSelect: (p: Pos) => void; hits: Hit[]; hit: Hit | null; scrollTo: Pos | null; onScrolled: () => void;
}) {
  const scroller = useRef<HTMLDivElement>(null);
  const [view, setView] = useState({ top: 0, left: 0, w: 800, h: 500 });
  const hiddenR = useMemo(() => new Set(sheet.hiddenRows ?? []), [sheet]);
  const hiddenC = useMemo(() => new Set(sheet.hiddenCols ?? []), [sheet]);
  const rowCount = Math.max(sheet.rows, 1); const colCount = Math.max(sheet.cols, 1);
  const rowOff = useMemo(() => buildOffsets(rowCount, (r) => (hiddenR.has(r) ? 0 : sheet.rowHeights[r] ?? DEFAULT_ROW_H)), [sheet, rowCount, hiddenR]);
  const colOff = useMemo(() => buildOffsets(colCount, (c) => (hiddenC.has(c) ? 0 : sheet.colWidths[c] ?? DEFAULT_COL_W)), [sheet, colCount, hiddenC]);
  const merges = useMemo(() => indexMerges(sheet.merges), [sheet]);
  const hitSet = useMemo(() => new Set(hits.map((h) => cellKey(h.r, h.c))), [hits]);
  const bodyW = colOff[colCount]!; const bodyH = rowOff[rowCount]!;
  const fr = Math.min(sheet.frozen.rows, rowCount); const fc = Math.min(sheet.frozen.cols, colCount);
  const frozenH = rowOff[fr]!; const frozenW = colOff[fc]!;

  useEffect(() => {
    const el = scroller.current; if (!el) return;
    const measure = () => setView((v) => ({ ...v, w: el.clientWidth, h: el.clientHeight }));
    const ro = new ResizeObserver(measure); ro.observe(el); measure();
    return () => ro.disconnect();
  }, []);
  const raf = useRef(0);
  const onScroll = () => { if (raf.current) return; raf.current = requestAnimationFrame(() => { raf.current = 0; const el = scroller.current; if (el) setView((v) => ({ ...v, top: el.scrollTop, left: el.scrollLeft })); }); };

  // Bring a cell into view (below the frozen rows / right of the frozen columns).
  useEffect(() => {
    if (!scrollTo) return;
    const el = scroller.current; if (!el) return;
    const { r, c } = scrollTo;
    const top = rowOff[r] ?? 0; const bottom = rowOff[r + 1] ?? top; const left = colOff[c] ?? 0; const right = colOff[c + 1] ?? left;
    const viewH = el.clientHeight - HDR; const viewW = el.clientWidth - RH;
    if (r >= fr) { if (top - frozenH < el.scrollTop) el.scrollTop = Math.max(0, top - frozenH); else if (bottom > el.scrollTop + viewH) el.scrollTop = bottom - viewH; }
    if (c >= fc) { if (left - frozenW < el.scrollLeft) el.scrollLeft = Math.max(0, left - frozenW); else if (right > el.scrollLeft + viewW) el.scrollLeft = right - viewW; }
    onScrolled();
  }, [scrollTo]); // eslint-disable-line react-hooks/exhaustive-deps

  const bodyView = { h: Math.max(0, view.h - HDR), w: Math.max(0, view.w - RH) };
  const rows = rangeFor(rowOff, view.top + frozenH, bodyView.h, OVERSCAN);
  const cols = rangeFor(colOff, view.left + frozenW, bodyView.w, OVERSCAN);
  const rStart = Math.max(rows.first, fr); const cStart = Math.max(cols.first, fc);

  const cellNode = (r: number, c: number, merge: Merge | undefined, layer: "main" | "rows" | "cols" | "corner"): ReactNode => {
    const cell = cellAt(sheet, r, c);
    const m = merge;
    const x = colOff[c]!; const y = rowOff[r]!;
    const w = (colOff[(m?.c2 ?? c) + 1] ?? x) - x; const h = (rowOff[(m?.r2 ?? r) + 1] ?? y) - y;
    if (w <= 0 || h <= 0) return null;
    const st = cell?.s !== undefined ? sheet.styles[cell.s] : undefined;
    const isSel = selected?.r === r && selected?.c === c;
    const isHit = hitSet.has(cellKey(r, c)); const isCur = hit?.r === r && hit?.c === c;
    const align = st?.align ?? (cell?.n === "n" || cell?.n === "d" ? "right" : cell?.n === "e" || cell?.n === "b" ? "center" : "left");
    const style: CSSProperties = {
      left: layer === "rows" ? x + RH : x, top: y, width: w, height: h,
      background: isCur ? "rgb(255 190 0 / .55)" : isHit ? "rgb(255 230 0 / .4)" : st?.bg ?? undefined,
      color: st?.color ?? (cell?.n === "e" ? "var(--destructive, #c00)" : undefined),
      fontWeight: st?.b ? 700 : undefined, fontStyle: st?.i ? "italic" : undefined, textDecoration: st?.u ? "underline" : undefined,
      fontSize: st?.size ? `${Math.round(st.size * 1.2)}px` : undefined, textAlign: align,
      whiteSpace: st?.wrap ? "pre-wrap" : "nowrap", overflowWrap: st?.wrap ? "anywhere" : undefined,
    };
    return (
      <div key={cellKey(r, c)} role="gridcell" aria-selected={isSel} data-cell={refOf(r, c)} onClick={() => onSelect({ r, c })}
        className={cn("absolute overflow-hidden text-ellipsis border-b border-r border-border/60 px-1.5 text-[13px] leading-[22px]", !st?.bg && "bg-background", isSel && "z-[1] outline outline-2 -outline-offset-2 outline-primary")} style={style}>
        {cell?.t}
      </div>
    );
  };

  // Extra merged blocks whose top-left cell is out of the drawn range but which still reach into view.
  const extraMerges = useMemo(() => sheet.merges.filter((m) => (m.r1 < rStart || m.c1 < cStart) && m.r2 >= rStart && m.r1 <= rows.last && m.c2 >= cStart && m.c1 <= cols.last && m.r1 >= fr && m.c1 >= fc), [sheet.merges, rStart, cStart, rows.last, cols.last, fr, fc]);

  const mainCells: ReactNode[] = [];
  for (let r = rStart; r <= rows.last; r++) {
    if (hiddenR.has(r)) continue;
    for (let c = cStart; c <= cols.last; c++) {
      const k = cellKey(r, c);
      if (hiddenC.has(c) || merges.covered.has(k)) continue;
      const cell = sheet.cells.get(k); const m = merges.master.get(k);
      if (cell || m || hitSet.has(k) || (selected?.r === r && selected?.c === c)) mainCells.push(cellNode(r, c, m, "main"));
      else mainCells.push(<div key={k} className="absolute border-b border-r border-border/60 bg-background" style={{ left: colOff[c]!, top: rowOff[r]!, width: colOff[c + 1]! - colOff[c]!, height: rowOff[r + 1]! - rowOff[r]! }} />);
    }
  }
  for (const m of extraMerges) mainCells.push(cellNode(m.r1, m.c1, m, "main"));
  const rowsLayer: ReactNode[] = [];   // frozen rows, scrolling sideways
  for (let r = 0; r < fr; r++) for (let c = cStart; c <= cols.last; c++) { const k = cellKey(r, c); if (!hiddenR.has(r) && !hiddenC.has(c) && !merges.covered.has(k)) rowsLayer.push(cellNode(r, c, merges.master.get(k), "rows")); }
  const colsLayer: ReactNode[] = [];   // frozen columns, scrolling up and down
  for (let r = rStart; r <= rows.last; r++) for (let c = 0; c < fc; c++) { const k = cellKey(r, c); if (!hiddenR.has(r) && !hiddenC.has(c) && !merges.covered.has(k)) colsLayer.push(cellNode(r, c, merges.master.get(k), "cols")); }
  const cornerLayer: ReactNode[] = [];
  for (let r = 0; r < fr; r++) for (let c = 0; c < fc; c++) { const k = cellKey(r, c); if (!hiddenR.has(r) && !hiddenC.has(c) && !merges.covered.has(k)) cornerLayer.push(cellNode(r, c, merges.master.get(k), "corner")); }

  const hdrCell = (key: string, style: CSSProperties, label: string, active: boolean) => (
    <div key={key} className={cn("absolute flex items-center justify-center border-b border-r bg-muted text-[11px] text-muted-foreground", active && "bg-accent font-semibold text-foreground")} style={style}>{label}</div>
  );
  const colHdr = (from: number, to: number, shift: number) => { const out: ReactNode[] = []; for (let c = from; c <= to; c++) if (!hiddenC.has(c)) out.push(hdrCell(`c${c}`, { left: colOff[c]! + shift, top: 0, width: colOff[c + 1]! - colOff[c]!, height: HDR }, colName(c), selected?.c === c)); return out; };
  const rowHdr = (from: number, to: number) => { const out: ReactNode[] = []; for (let r = from; r <= to; r++) if (!hiddenR.has(r)) out.push(hdrCell(`r${r}`, { left: 0, top: rowOff[r]!, width: RH, height: rowOff[r + 1]! - rowOff[r]! }, String(r + 1), selected?.r === r)); return out; };

  const move = (dr: number, dc: number) => {
    const cur = selected ?? { r: 0, c: 0 };
    onSelect({ r: Math.min(rowCount - 1, Math.max(0, cur.r + dr)), c: Math.min(colCount - 1, Math.max(0, cur.c + dc)) });
  };
  const onKey = (e: React.KeyboardEvent) => {
    const k = e.key;
    if (k === "ArrowDown") move(1, 0); else if (k === "ArrowUp") move(-1, 0); else if (k === "ArrowRight") move(0, 1); else if (k === "ArrowLeft") move(0, -1);
    else if (k === "PageDown") move(Math.max(1, Math.floor(bodyView.h / DEFAULT_ROW_H) - 1), 0); else if (k === "PageUp") move(-Math.max(1, Math.floor(bodyView.h / DEFAULT_ROW_H) - 1), 0);
    else if (k === "Home") onSelect({ r: selected?.r ?? 0, c: 0 }); else if (k === "End") onSelect({ r: selected?.r ?? 0, c: Math.max(0, sheet.cols - 1) });
    else return;
    e.preventDefault();
  };
  const onCopy = (e: React.ClipboardEvent) => { if (!selected) return; const t = cellAt(sheet, selected.r, selected.c)?.t ?? ""; e.clipboardData.setData("text/plain", t); e.preventDefault(); };

  return (
    <div ref={scroller} onScroll={onScroll} onKeyDown={onKey} onCopy={onCopy} tabIndex={0} role="grid" aria-label={`Sheet ${sheet.name}`} aria-rowcount={rowCount} aria-colcount={colCount}
      className="relative min-h-0 flex-1 overflow-auto bg-background outline-none focus-visible:ring-1 focus-visible:ring-primary" data-testid="sheet-scroller">
      <div className="relative" style={{ width: RH + bodyW, height: HDR + bodyH }}>
        {/* Every layer below is a zero-height, sticky strip that starts just under the column headers (y = HDR). `top: HDR` keeps a strip
            pinned there while scrolling; `left: RH` pins it beside the row headers. Children are placed relative to the strip. */}
        <div className="sticky top-0 z-[12]" style={{ height: HDR, width: RH + bodyW }}>{colHdr(cStart, cols.last, RH)}</div>
        {fc > 0 && <div className="sticky z-[13]" style={{ top: HDR, left: RH, height: 0, width: 0 }}><div className="absolute" style={{ left: 0, top: -HDR }}>{colHdr(0, fc - 1, 0)}</div></div>}
        {fr > 0 && <div className="sticky z-[6]" style={{ top: HDR, height: 0, width: RH + bodyW }}>{rowsLayer}</div>}
        {fc > 0 && <div className="sticky z-[6]" style={{ left: RH, height: 0, width: 0 }}>{colsLayer}</div>}
        {fr > 0 && fc > 0 && <div className="sticky z-[7]" style={{ top: HDR, left: RH, height: 0, width: 0 }}>{cornerLayer}</div>}
        <div className="sticky z-[11]" style={{ left: 0, height: 0, width: RH }}>{rowHdr(rStart, rows.last)}</div>
        {fr > 0 && <div className="sticky z-[12]" style={{ left: 0, top: HDR, height: 0, width: RH }}>{rowHdr(0, fr - 1)}</div>}
        <div className="sticky z-[14]" style={{ left: 0, top: HDR, height: 0, width: 0 }}><div className="absolute border-b border-r bg-muted" style={{ left: 0, top: -HDR, width: RH, height: HDR }} /></div>
        <div className="absolute" style={{ left: RH, top: HDR, width: bodyW, height: bodyH }}>{mainCells}</div>
      </div>
    </div>
  );
}

export function SpreadsheetViewer({ workbook, name, onDownload, className }: { workbook: Workbook; name: string; onDownload?: () => void; className?: string }) {
  const root = useRef<HTMLDivElement>(null);
  const [idx, setIdx] = useState(0);
  const sheet = workbook.sheets[Math.min(idx, workbook.sheets.length - 1)]!;
  const [selected, setSelected] = useState<Pos | null>(null);
  const [scrollTo, setScrollTo] = useState<Pos | null>(null);
  const [query, setQuery] = useState("");
  const [hitAt, setHitAt] = useState(-1);
  const [jump, setJump] = useState("");
  const [jumpError, setJumpError] = useState(false);
  const [full, setFull] = useState(false);

  useEffect(() => { setSelected(null); setScrollTo(null); setQuery(""); setHitAt(-1); setJump(""); }, [idx, workbook]);
  useEffect(() => {
    const on = () => setFull(document.fullscreenElement === root.current);
    document.addEventListener("fullscreenchange", on);
    return () => document.removeEventListener("fullscreenchange", on);
  }, []);

  const hits = useMemo(() => searchSheet(sheet, query), [sheet, query]);
  const hit = hitAt >= 0 ? hits[hitAt] ?? null : null;
  useEffect(() => { setHitAt(hits.length ? 0 : -1); }, [hits]);
  useEffect(() => { if (hit) { setSelected(hit); setScrollTo({ ...hit }); } }, [hit]);

  const select = useCallback((p: Pos) => { setSelected(p); setScrollTo({ ...p }); }, []);
  const cell: Cell | undefined = selected ? cellAt(sheet, selected.r, selected.c) : undefined;
  const step = (dir: 1 | -1) => setHitAt(nextHitIndex(hits, hit, dir));
  const go = () => { const p = parseRef(jump); if (!p || p.r >= Math.max(sheet.rows, 1) || p.c >= Math.max(sheet.cols, 1)) { setJumpError(true); return; } setJumpError(false); select(p); };
  const toggleFull = () => { if (document.fullscreenElement) void document.exitFullscreen(); else void root.current?.requestFullscreen?.().catch(() => undefined); };
  const formula = cell?.f ? `=${cell.f}` : cell ? (cell.v !== undefined ? String(cell.v) : cell.t) : "";

  return (
    <div ref={root} className={cn("flex h-full min-h-0 flex-col bg-background", className)}>
      <ViewerToolbar>
        <form className="flex items-center gap-1" onSubmit={(e) => { e.preventDefault(); go(); }}>
          <Input aria-label="Go to cell" placeholder={selected ? refOf(selected.r, selected.c) : "A1"} aria-invalid={jumpError} className={cn("h-8 w-20 px-2 text-center", jumpError && "border-destructive")} value={jump} onChange={(e) => { setJump(e.target.value.slice(0, 12)); setJumpError(false); }} />
        </form>
        <div aria-label="Formula bar" className="mx-1 flex h-8 min-w-40 flex-1 items-center gap-2 rounded-md border bg-muted/30 px-2 text-xs">
          <span className="italic text-muted-foreground">fx</span>
          <span className="truncate font-mono" title={formula}>{formula}</span>
        </div>
        <Divider />
        <div className="flex items-center gap-1">
          <Search className="size-4 text-muted-foreground" aria-hidden />
          <Input aria-label="Search the sheet" placeholder="Find" className="h-8 w-32 px-2" value={query} onChange={(e) => setQuery(e.target.value)} onKeyDown={(e) => { if (e.key === "Enter") { e.preventDefault(); step(e.shiftKey ? -1 : 1); } }} />
          <ToolButton label="Previous match" disabled={!hits.length} onClick={() => step(-1)}><ChevronUp className="size-4" /></ToolButton>
          <ToolButton label="Next match" disabled={!hits.length} onClick={() => step(1)}><ChevronDown className="size-4" /></ToolButton>
          <span className="w-16 text-xs text-muted-foreground" role="status">{query.trim() ? (hits.length ? `${hitAt + 1} of ${hits.length}` : "No matches") : ""}</span>
          {query && <ToolButton label="Clear search" onClick={() => setQuery("")}><X className="size-4" /></ToolButton>}
        </div>
        <Divider />
        {onDownload && <ToolButton label="Download" onClick={onDownload}><Download className="size-4" /></ToolButton>}
        <ToolButton label={full ? "Exit full screen" : "Full screen"} onClick={toggleFull}>{full ? <Minimize2 className="size-4" /> : <Maximize2 className="size-4" />}</ToolButton>
      </ViewerToolbar>
      <Grid sheet={sheet} selected={selected} onSelect={select} hits={hits} hit={hit} scrollTo={scrollTo} onScrolled={() => undefined} />
      <div className="flex flex-wrap items-center gap-x-3 border-t bg-muted/30 px-2 py-1 text-xs">
        <div role="tablist" aria-label="Sheets" className="flex max-w-full gap-1 overflow-x-auto">
          {workbook.sheets.map((s, i) => (
            <button key={i} type="button" role="tab" aria-selected={i === idx} onClick={() => setIdx(i)} className={cn("whitespace-nowrap rounded-t px-3 py-1 hover:bg-accent/50", i === idx ? "bg-background font-semibold shadow-[inset_0_-2px_0_var(--primary,#06f)]" : "text-muted-foreground")}>{s.name}</button>
          ))}
        </div>
        <span className="text-muted-foreground">{describeSheet(sheet)} · read-only, formulas show their saved results, macros never run</span>
        {workbook.notes.map((n, i) => <span key={i} className="text-muted-foreground">{n}</span>)}
        <span className="sr-only">{name}</span>
      </div>
    </div>
  );
}

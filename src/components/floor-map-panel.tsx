import { useEffect, useMemo, useRef, useState } from "react";
import { Download, FileUp, MapPin, RotateCcw } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { buildEntries, cellAround, locate, mergeTexts, parseBooth, parseWorkOrderLines, placedCsv, planKey, questionsCsv, resolve, type Answers, type Box, type Entry, type Question } from "@/lib/floor-map";
import type { PlanDoc } from "@/lib/floor-map-pdf";

type Saved = { answers: Answers; ok: Record<string, true> };
const storeKey = (k: string) => `pixelpals:floormap:${k}`;
const load = (k: string): Saved => { try { return JSON.parse(localStorage.getItem(storeKey(k)) ?? "") as Saved; } catch { return { answers: {}, ok: {} }; } };
const save = (k: string, v: Saved) => { try { localStorage.setItem(storeKey(k), JSON.stringify(v)); } catch { /* private window: answers just won't be remembered */ } };

/**
 * Floor map: drop a floor plan PDF and the "Better Work Order Items" PDF, get the plan colored.
 * Anything it isn't sure of goes in a "Needs your answer" list; answers are remembered for that plan.
 */
export function FloorMapPanel() {
  const [plan, setPlan] = useState<PlanDoc | null>(null);
  const [name, setName] = useState("");
  const [entries, setEntries] = useState<Entry[]>([]);
  const [status, setStatus] = useState("");
  const [saved, setSaved] = useState<Saved>({ answers: {}, ok: {} });
  const [sel, setSel] = useState<string | null>(null);
  const [picks, setPicks] = useState<Box[]>([]);
  const [typed, setTyped] = useState("");
  const [zoom, setZoom] = useState(1);
  const [pageNo, setPageNo] = useState(1);
  const [files, setFiles] = useState<File[]>([]);
  const view = useRef<HTMLCanvasElement>(null);
  const base = useRef<HTMLCanvasElement | null>(null);
  const geom = useRef({ s: 1, band: 0 });

  const key = plan ? planKey(name, plan.prims) : "";
  const resolved = useMemo(() => (plan ? resolve(plan.prims, entries, saved.answers) : null), [plan, entries, saved.answers]);
  const open = (resolved?.questions ?? []).filter((q) => !saved.ok[q.id]);
  const blocking = open.filter((q) => q.kind !== "check");
  const checks = open.filter((q) => q.kind === "check");

  async function read(fs: File[], page = pageNo) {
    setStatus("Reading…"); setPlan(null); setSel(null); setPicks([]);
    try {
      const pdf = await import("@/lib/floor-map-pdf");
      let lines: string[] = []; let planFile: File | null = null;
      for (const f of fs.filter((x) => /\.pdf$/i.test(x.name))) {
        const l = await pdf.readWorkOrder(f);
        if (parseWorkOrderLines(l).length >= 3) lines = l; else planFile = f;
      }
      if (!planFile || !lines.length) { setStatus(!planFile ? "I need the floor plan PDF too (drop both together)." : "I need the Better Work Order Items PDF too (drop both together)."); setFiles(fs); return; }
      const doc = await pdf.readPlan(planFile, page);
      const ents = buildEntries(parseWorkOrderLines(lines));
      setPlan(doc); setName(planFile.name); setEntries(ents); setFiles(fs);
      setSaved(load(planKey(planFile.name, doc.prims)));
      const s = pdf.pickScale(doc.prims);
      const c = document.createElement("canvas");
      await doc.render(c, s);
      base.current = c; geom.current = { s, band: 0 };
      setStatus("");
    } catch (e) { setStatus(`Couldn't read those PDFs: ${(e as Error).message}`); }
  }

  // paint: plan + legend strip + colors (+ the booths being picked)
  useEffect(() => {
    const v = view.current, b = base.current;
    if (!v || !b || !plan || !resolved) return;
    let alive = true;
    import("@/lib/floor-map-pdf").then((pdf) => {
      if (!alive) return;
      const { s } = geom.current;
      const tmp = document.createElement("canvas");
      tmp.width = b.width; tmp.height = 10;
      const ctx0 = tmp.getContext("2d"); if (!ctx0) return;
      const band = Math.ceil(pdf.drawLegend(ctx0, b.width, s, `POWER ORDERS — ${name.replace(/\.pdf$/i, "")}`));
      geom.current = { s, band };
      v.width = b.width; v.height = b.height + band;
      const ctx = v.getContext("2d"); if (!ctx) return;
      ctx.fillStyle = "#fff"; ctx.fillRect(0, 0, v.width, v.height);
      pdf.drawLegend(ctx, b.width, s, `POWER ORDERS — ${name.replace(/\.pdf$/i, "")}`);
      ctx.drawImage(b, 0, band);
      pdf.drawOverlay(ctx, s, resolved.placed, picks, band);
    });
    return () => { alive = false; };
  }, [plan, resolved, picks, name]);

  const commit = (q: Question, cells: Box[]) => { const next = { ...saved, answers: { ...saved.answers, [q.entryKey]: { cells } } }; setSaved(next); save(key, next); setPicks([]); setSel(null); setTyped(""); };
  const skip = (q: Question) => { const next = { ...saved, answers: { ...saved.answers, [q.entryKey]: { skip: true as const } } }; setSaved(next); save(key, next); setSel(null); setPicks([]); };
  const okay = (q: Question) => { const next = { ...saved, ok: { ...saved.ok, [q.id]: true as const } }; setSaved(next); save(key, next); };
  const forget = () => { const next: Saved = { answers: {}, ok: {} }; setSaved(next); save(key, next); setSel(null); setPicks([]); };

  function onClick(e: React.MouseEvent<HTMLCanvasElement>) {
    if (!sel || !plan) return;
    const v = e.currentTarget, r = v.getBoundingClientRect();
    const { s, band } = geom.current;
    const x = ((e.clientX - r.left) / r.width) * v.width / s;
    const y = (((e.clientY - r.top) / r.height) * v.height - band) / s;
    const c = cellAround(plan.prims, x, y);
    if (c) setPicks((p) => (p.some((q) => q.x === c.x && q.y === c.y) ? p.filter((q) => !(q.x === c.x && q.y === c.y)) : [...p, c]));
    else setStatus("I couldn't find a booth outline there — try the middle of the booth.");
  }

  function tryTyped(q: Question) {
    if (!plan) return;
    const labels = mergeTexts(plan.prims.texts);
    const cells = parseBooth(typed).ids.map((id) => locate(plan.prims, labels, id)).filter((c): c is Box => !!c);
    if (cells.length) setPicks(cells); else setStatus(`"${typed}" isn't labeled on the plan either.`);
    setSel(q.id);
  }

  async function out(kind: "png" | "pdf" | "placed" | "questions") {
    if (!view.current || !resolved) return;
    const pdf = await import("@/lib/floor-map-pdf");
    const { downloadBlob } = await import("@/lib/work-files");
    const base0 = name.replace(/\.pdf$/i, "") || "floor-plan";
    if (kind === "png") downloadBlob(await pdf.canvasToPngBlob(view.current), `${base0}-power-orders.png`);
    else if (kind === "pdf") downloadBlob(await pdf.canvasToPdfBlob(view.current), `${base0}-power-orders.pdf`);
    else if (kind === "placed") downloadBlob(new Blob([placedCsv(resolved.placed)], { type: "text/csv" }), `${base0}-colored.csv`);
    else downloadBlob(new Blob([questionsCsv(open)], { type: "text/csv" }), `${base0}-needs-your-answer.csv`);
  }

  const renderQ = (q: Question) => {
    const active = sel === q.id;
    return (
      <li key={q.id} className="rounded-md border border-border p-2 text-sm">
        <div className="font-medium">{q.exhibitor || "(no name)"} <span className="font-mono text-xs text-muted-foreground">{q.booth}</span></div>
        <div className="text-muted-foreground">{q.text}</div>
        {q.kind === "check" ? (
          <div className="mt-1 flex flex-wrap gap-2"><Button size="sm" variant="secondary" onClick={() => okay(q)}>Looks right</Button><Button size="sm" variant="outline" onClick={() => { setSel(active ? null : q.id); setPicks([]); }}><MapPin className="size-3.5" /> Fix on plan</Button></div>
        ) : (
          <div className="mt-1 space-y-1">
            {(q.hints ?? []).filter((h) => h.cell).map((h, i) => (
              <Button key={i} size="sm" variant="outline" className="mr-1" onClick={() => { setSel(q.id); setPicks([h.cell!]); }}>Use “{h.text.slice(0, 30)}” on the plan</Button>
            ))}
            <div className="flex flex-wrap items-center gap-2">
              <Button size="sm" variant={active ? "default" : "outline"} onClick={() => { setSel(active ? null : q.id); setPicks([]); }}><MapPin className="size-3.5" /> {active ? "Click the booth(s) on the plan…" : "Pick on plan"}</Button>
              <Input value={active ? typed : ""} onChange={(e) => { setTyped(e.target.value); setSel(q.id); }} placeholder="or type its booth #" className="h-8 w-36" />
              <Button size="sm" variant="outline" disabled={!active || !typed.trim()} onClick={() => tryTyped(q)}>Find</Button>
              <Button size="sm" variant="ghost" onClick={() => skip(q)}>Skip</Button>
            </div>
          </div>
        )}
        {active && picks.length > 0 && (
          <div className="mt-1 flex items-center gap-2"><span className="text-xs text-muted-foreground">{picks.length} booth{picks.length > 1 ? "s" : ""} outlined in blue.</span><Button size="sm" onClick={() => commit(q, picks)}>Color {picks.length > 1 ? "them" : "it"}</Button><Button size="sm" variant="ghost" onClick={() => setPicks([])}>Clear</Button></div>
        )}
      </li>
    );
  };

  return (
    <div className="space-y-3 pt-2">
      <label className="flex cursor-pointer items-center justify-center gap-2 rounded-md border border-dashed border-border p-4 text-sm text-muted-foreground hover:bg-muted">
        <FileUp className="size-4" /> Drop the floor plan PDF and the Better Work Order Items PDF together
        <input type="file" accept="application/pdf" multiple className="sr-only" onChange={(e) => { const l = [...(e.target.files ?? [])]; if (l.length) void read(l); e.target.value = ""; }} />
      </label>
      <p className="text-xs text-muted-foreground">10 amp = yellow · 20 amp = orange · both = split · more than one → x#. Small squares: red 30 amp, green 60 amp, blue water, purple compressed air. Showcase power is yellow (SCase xN), track lights show A / B xN. Runs in this browser; answers you give are remembered for the same plan.</p>
      {status && <p className="text-sm">{status}</p>}
      {plan && resolved && (
        <>
          <p className="text-sm font-medium">{resolved.placed.length} colored · {blocking.length} need your answer{checks.length ? ` · ${checks.length} to double-check` : ""}</p>
          <div className="flex flex-wrap items-center gap-2">
            <Button size="sm" onClick={() => void out("png")}><Download className="size-4" /> Picture (PNG)</Button>
            <Button size="sm" variant="outline" onClick={() => void out("pdf")}><Download className="size-4" /> PDF</Button>
            <Button size="sm" variant="outline" onClick={() => void out("placed")}><Download className="size-4" /> Colored list (CSV)</Button>
            {open.length > 0 && <Button size="sm" variant="outline" onClick={() => void out("questions")}><Download className="size-4" /> Questions (CSV)</Button>}
            <Button size="sm" variant="ghost" onClick={forget} title="Forget the answers saved for this plan"><RotateCcw className="size-4" /> Reset answers</Button>
            <label className="ml-auto flex items-center gap-1 text-xs text-muted-foreground">Zoom <Input type="range" min={1} max={4} step={0.5} value={zoom} onChange={(e) => setZoom(Number(e.target.value))} className="h-6 w-24" /></label>
            <label className="flex items-center gap-1 text-xs text-muted-foreground">Page <Input type="number" min={1} value={pageNo} onChange={(e) => setPageNo(Math.max(1, Number(e.target.value) || 1))} onBlur={() => files.length && void read(files, pageNo)} className="h-7 w-16" /></label>
          </div>
          <div className="max-h-[60vh] overflow-auto rounded-md border border-border bg-white">
            <canvas ref={view} onClick={onClick} style={{ width: `${zoom * 100}%`, cursor: sel ? "crosshair" : "default" }} />
          </div>
          {blocking.length > 0 && (<><h4 className="text-sm font-semibold">Needs your answer</h4><ul className="space-y-2">{blocking.map(renderQ)}</ul></>)}
          {checks.length > 0 && (<details><summary className="cursor-pointer text-sm font-semibold">Double-check ({checks.length})</summary><ul className="mt-2 space-y-2">{checks.map(renderQ)}</ul></details>)}
        </>
      )}
    </div>
  );
}

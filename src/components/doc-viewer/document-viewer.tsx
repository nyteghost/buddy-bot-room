import { lazy, Suspense, useEffect, useState } from "react";
import { Download, Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { fetchSource, humanSize, mailAttachmentUrl, saveBytes, sourceKey, sourceKind, sourceName, type DocSource } from "@/lib/doc-viewer/doc-source";
import { loadWorkbook } from "@/lib/doc-viewer/sheet-client";
import type { Workbook } from "@/lib/doc-viewer/sheet-model";

// The two viewers (and pdf.js / exceljs behind them) are separate chunks that load only when a file of that kind is opened.
const PdfViewer = lazy(() => import("./pdf-viewer").then((m) => ({ default: m.PdfViewer })));
const SpreadsheetViewer = lazy(() => import("./spreadsheet-viewer").then((m) => ({ default: m.SpreadsheetViewer })));

type Loaded = { kind: "pdf"; buffer: ArrayBuffer } | { kind: "sheet"; workbook: Workbook; buffer: ArrayBuffer } | { kind: "other" };

const Loading = ({ label }: { label: string }) => <div className="flex items-center gap-2 p-6 text-sm text-muted-foreground" role="status"><Loader2 className="size-4 animate-spin" /> {label}</div>;

/** Opens one document read-only: picks the PDF or spreadsheet viewer, fetches the bytes, and cancels everything if the file changes or the viewer closes. */
export function DocumentViewer({ source, className }: { source: DocSource; className?: string }) {
  const [loaded, setLoaded] = useState<Loaded | null>(null);
  const [error, setError] = useState("");
  const key = sourceKey(source);
  const name = sourceName(source);
  const kind = sourceKind(source);

  useEffect(() => {
    const ctl = new AbortController();
    setLoaded(null); setError("");
    if (kind === "other") { setLoaded({ kind: "other" }); return; }
    (async () => {
      const { buffer } = await fetchSource(source, ctl.signal);
      if (ctl.signal.aborted) return;
      if (kind === "pdf") { setLoaded({ kind: "pdf", buffer }); return; }
      const workbook = await loadWorkbook(buffer.slice(0), name, ctl.signal);
      if (!ctl.signal.aborted) setLoaded({ kind: "sheet", workbook, buffer });
    })().catch((e) => { if (!ctl.signal.aborted) setError(e instanceof Error ? e.message : "Couldn't open this file."); });
    return () => ctl.abort();
    // eslint-disable-next-line react-hooks/exhaustive-deps -- `key` identifies the source
  }, [key]);

  const download = () => {
    if (source.kind === "mail") { const a = document.createElement("a"); a.href = mailAttachmentUrl(source, true); a.download = name; document.body.appendChild(a); a.click(); a.remove(); return; }
    void source.file.arrayBuffer().then((buf) => saveBytes(buf, name, source.file.type || undefined));
  };

  if (error) return (
    <div className={className}>
      <div role="alert" className="grid gap-3 p-6 text-sm"><p className="text-destructive">{error}</p>{source.kind === "mail" && <div><Button size="sm" variant="outline" onClick={download}><Download className="size-3" /> Download instead</Button></div>}</div>
    </div>
  );
  if (!loaded) return <div className={className}><Loading label={`Loading ${name}…`} /></div>;
  if (loaded.kind === "other") return (
    <div className={className}><div className="grid gap-3 p-6 text-sm"><p>{name} can't be previewed here. Only PDF and Excel/CSV files open in the viewer.</p><div><Button size="sm" onClick={download}><Download className="size-3" /> Download</Button></div></div></div>
  );
  return (
    <div className={className} data-doc-ready={loaded.kind} data-doc-size={humanSize(loaded.buffer?.byteLength ?? 0)}>
      <Suspense fallback={<Loading label="Starting the viewer…" />}>
        {loaded.kind === "pdf" ? <PdfViewer buffer={loaded.buffer} name={name} onDownload={download} /> : <SpreadsheetViewer workbook={loaded.workbook} name={name} onDownload={download} />}
      </Suspense>
    </div>
  );
}

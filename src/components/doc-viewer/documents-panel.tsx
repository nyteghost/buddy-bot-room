import { useCallback, useEffect, useRef, useState } from "react";
import { ArrowLeft, FileSpreadsheet, FileText, Trash2, Upload } from "lucide-react";
import { Button } from "@/components/ui/button";
import { humanSize, sourceKind, type DocSource } from "@/lib/doc-viewer/doc-source";
import { RECENT_KEY, addRecent, parseRecent, removeRecent, type RecentDoc } from "@/lib/doc-viewer/recent";
import { DocumentViewer } from "./document-viewer";

const ACCEPT = ".pdf,.xlsx,.xlsm,.xls,.csv,application/pdf,text/csv";

/** The Documents window: open a PDF or Excel/CSV file from your device and read it here. Files are read in this tab and never uploaded. */
export function DocumentsPanel() {
  const [recent, setRecent] = useState<RecentDoc[]>([]);
  const [current, setCurrent] = useState<DocSource | null>(null);
  const [note, setNote] = useState("");
  const [over, setOver] = useState(false);
  const session = useRef(new Map<string, File>());
  const input = useRef<HTMLInputElement>(null);

  useEffect(() => { try { setRecent(parseRecent(localStorage.getItem(RECENT_KEY))); } catch { /* storage unavailable */ } }, []);
  const save = useCallback((next: RecentDoc[]) => { setRecent(next); try { localStorage.setItem(RECENT_KEY, JSON.stringify(next)); } catch { /* storage unavailable */ } }, []);

  const openFile = useCallback((file: File | undefined) => {
    if (!file) return;
    const source: DocSource = { kind: "file", file };
    const kind = sourceKind(source);
    if (kind === "other") { setNote(`${file.name} isn't a PDF or Excel/CSV file, so it can't be viewed here.`); return; }
    const id = `local:${file.name}:${file.size}:${file.lastModified}`;
    session.current.set(id, file);
    setNote(""); setCurrent(source);
    save(addRecent(recent, { id, kind, name: file.name, size: file.size, at: Date.now(), origin: "local" }));
  }, [recent, save]);

  const reopen = (d: RecentDoc) => {
    setNote("");
    if (d.origin === "mail") { setCurrent({ kind: "mail", folder: d.folder, uid: d.uid, index: d.index, name: d.name, size: d.size }); save(addRecent(recent, { ...d, at: Date.now() })); return; }
    const file = session.current.get(d.id);
    if (file) { setCurrent({ kind: "file", file }); save(addRecent(recent, { ...d, at: Date.now() })); } else { setNote(`Choose ${d.name} again: Pixel Pals doesn't keep a copy of your files.`); input.current?.click(); }
  };

  if (current) {
    return (
      <div className="grid gap-2">
        <div className="flex items-center gap-2"><Button size="sm" variant="ghost" className="h-8 px-2" onClick={() => setCurrent(null)}><ArrowLeft className="size-4" /> Back</Button></div>
        <DocumentViewer source={current} className="h-[min(72dvh,760px)] min-h-[360px] overflow-hidden rounded-md border" />
      </div>
    );
  }
  return (
    <div className="grid gap-3">
      <label
        onDragOver={(e) => { e.preventDefault(); setOver(true); }} onDragLeave={() => setOver(false)}
        onDrop={(e) => { e.preventDefault(); setOver(false); openFile(e.dataTransfer.files[0]); }}
        className={`flex cursor-pointer flex-col items-center gap-1 rounded-md border-2 border-dashed px-4 py-8 text-center text-sm hover:bg-accent/30 ${over ? "bg-accent/40" : ""}`}>
        <Upload className="size-5 text-muted-foreground" />
        <span className="font-medium">Open a PDF or Excel file</span>
        <span className="text-xs text-muted-foreground">Drop it here or click to choose. PDF, .xlsx, .xlsm, .xls and .csv. Read-only; the file stays in your browser.</span>
        <input ref={input} data-testid="doc-input" type="file" accept={ACCEPT} className="sr-only" onChange={(e) => { openFile(e.target.files?.[0]); e.target.value = ""; }} />
      </label>
      {note && <p role="status" className="text-xs text-muted-foreground">{note}</p>}
      <div className="grid gap-1">
        <div className="flex items-center justify-between"><span className="text-xs font-medium text-muted-foreground">Recent</span>{recent.length > 0 && <Button size="sm" variant="ghost" className="h-6 px-2 text-xs" onClick={() => save([])}><Trash2 className="size-3" /> Clear</Button>}</div>
        {recent.length === 0 && <p className="text-xs text-muted-foreground">Nothing opened yet. Mail attachments you preview show up here too.</p>}
        {recent.map((d) => (
          <div key={d.id} className="flex items-stretch gap-1">
            <button type="button" onClick={() => reopen(d)} className="flex min-w-0 flex-1 items-center gap-2 rounded-md border px-3 py-2 text-left hover:bg-accent/40">
              {d.kind === "sheet" ? <FileSpreadsheet className="size-4 shrink-0 text-muted-foreground" /> : <FileText className="size-4 shrink-0 text-muted-foreground" />}
              <span className="min-w-0 flex-1"><span className="block truncate text-sm">{d.name}</span><span className="block truncate text-xs text-muted-foreground">{d.origin === "mail" ? "From Mail" : "From this device"}{d.size >= 0 ? ` · ${humanSize(d.size)}` : ""} · {new Date(d.at).toLocaleString([], { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" })}</span></span>
            </button>
            <Button size="sm" variant="ghost" className="h-auto px-2" aria-label={`Remove ${d.name} from recent`} onClick={() => save(removeRecent(recent, d.id))}><Trash2 className="size-3" /></Button>
          </div>
        ))}
      </div>
    </div>
  );
}

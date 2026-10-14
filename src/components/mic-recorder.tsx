import { useEffect, useRef, useState } from "react";
import { Copy, Download, FileText, Mic, Square, X } from "lucide-react";
import { Button } from "@/components/ui/button";

type Part = { url: string; blob: Blob; seconds: number };
type Clip = { id: string; parts: Part[]; at: Date; seconds: number; transcript?: string; busy?: string; error?: string };

/** Each part is a complete file under the 15-minute transcription limit. */
const PART_MS = 14 * 60 * 1000;
const ext = (b: Blob) => (b.type.includes("mp4") ? "m4a" : b.type.includes("ogg") ? "ogg" : b.type.includes("wav") ? "wav" : "webm");
const fmt = (s: number) => `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`;

/** Echo's recorder: records from the microphone only after the user presses Record, splitting long recordings into parts. */
export function MicRecorder({ onClose }: { onClose: () => void }) {
  const [clips, setClips] = useState<Clip[]>([]);
  const [recording, setRecording] = useState(false);
  const [elapsed, setElapsed] = useState(0);
  const [error, setError] = useState("");
  const session = useRef<{ stream: MediaStream; rec: MediaRecorder; parts: Part[]; stopping: boolean; timer: number; partStart: number } | null>(null);
  const started = useRef(0);

  useEffect(() => {
    if (!recording) return;
    const t = setInterval(() => setElapsed(Math.round((Date.now() - started.current) / 1000)), 500);
    return () => clearInterval(t);
  }, [recording]);
  useEffect(() => () => { const s = session.current; if (s) { s.stopping = true; s.rec.state === "recording" && s.rec.stop(); } }, []);

  function startPart() {
    const s = session.current!;
    const r = new MediaRecorder(s.stream);
    const chunks: Blob[] = [];
    s.rec = r; s.partStart = Date.now();
    r.ondataavailable = (e) => e.data.size && chunks.push(e.data);
    r.onstop = () => {
      const blob = new Blob(chunks, { type: r.mimeType || "audio/webm" });
      s.parts.push({ url: URL.createObjectURL(blob), blob, seconds: Math.round((Date.now() - s.partStart) / 1000) });
      if (!s.stopping) return startPart();
      clearTimeout(s.timer);
      s.stream.getTracks().forEach((t) => t.stop());
      const parts = s.parts;
      session.current = null;
      setClips((c) => [{ id: crypto.randomUUID(), parts, at: new Date(), seconds: parts.reduce((n, p) => n + p.seconds, 0) }, ...c]);
      setRecording(false);
    };
    r.start();
    s.timer = window.setTimeout(() => r.state === "recording" && r.stop(), PART_MS);
  }

  async function start() {
    setError("");
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      session.current = { stream, rec: null as unknown as MediaRecorder, parts: [], stopping: false, timer: 0, partStart: 0 };
      started.current = Date.now(); setElapsed(0);
      startPart(); setRecording(true);
    } catch (e) {
      setError((e as Error).name === "NotAllowedError" ? "Microphone access was blocked — allow it in your browser settings and try again." : `Could not start the microphone: ${(e as Error).message}`);
    }
  }
  function stop() {
    const s = session.current; if (!s) return;
    s.stopping = true; clearTimeout(s.timer);
    if (s.rec.state === "recording") s.rec.stop();
  }

  const save = (c: Clip, i: number) => {
    const p = c.parts[i]!; const a = document.createElement("a"); a.href = p.url;
    a.download = `recording-${c.at.toISOString().slice(0, 19).replace(/[:T]/g, "-")}${c.parts.length > 1 ? `-part${i + 1}` : ""}.${ext(p.blob)}`; a.click();
  };

  const patch = (id: string, p: Partial<Clip>) => setClips((cs) => cs.map((c) => (c.id === id ? { ...c, ...p } : c)));
  async function transcribe(c: Clip) {
    patch(c.id, { busy: "Transcribing…", error: "", transcript: "" });
    let text = "";
    try {
      for (let i = 0; i < c.parts.length; i++) {
        const part = c.parts[i]!;
        if (c.parts.length > 1) { patch(c.id, { busy: `Transcribing part ${i + 1} of ${c.parts.length}…` }); text += `${i ? "\n\n" : ""}— Part ${i + 1} (${fmt(i * PART_MS / 1000)}) —\n`; }
        const bytes = new Uint8Array(await part.blob.arrayBuffer());
        let bin = "";
        for (let j = 0; j < bytes.length; j += 0x8000) bin += String.fromCharCode(...bytes.subarray(j, j + 0x8000));
        const res = await fetch("/api/transcribe", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ audio: btoa(bin), format: ext(part.blob), previous: text }) });
        if (!res.ok || !res.body) throw new Error((await res.json().catch(() => null))?.error ?? "The recording could not be transcribed.");
        const reader = res.body.pipeThrough(new TextDecoderStream()).getReader();
        for (;;) { const { done, value } = await reader.read(); if (done) break; text += value; patch(c.id, { transcript: text }); }
      }
      patch(c.id, { busy: "", transcript: text.trim() || "(no speech heard)" });
    } catch (e) { patch(c.id, { busy: "", transcript: text, error: (e as Error).message }); }
  }

  return (
    <div className="space-y-3 rounded-md border border-border bg-card p-3 text-card-foreground">
      <div className="flex items-center justify-between">
        <p className="text-sm font-medium">Echo's recorder</p>
        <Button size="icon" variant="ghost" aria-label="Close recorder" onClick={onClose}><X className="size-4" /></Button>
      </div>
      <div className="flex items-center gap-3">
        {recording
          ? <Button size="sm" variant="destructive" onClick={stop}><Square className="size-4" /> Stop</Button>
          : <Button size="sm" onClick={start}><Mic className="size-4" /> Record</Button>}
        <span className="text-sm text-muted-foreground">{recording ? `Recording… ${fmt(elapsed)}${elapsed >= PART_MS / 1000 ? ` · part ${Math.floor(elapsed / (PART_MS / 1000)) + 1}` : ""}` : "Long recordings split into 14-minute parts automatically."}</span>
      </div>
      {error && <p className="text-sm text-destructive">{error}</p>}
      {clips.map((c) => (
        <div key={c.id} className="space-y-1">
          <div className="flex items-center gap-2">
          <span className="flex-1 text-xs text-muted-foreground">{fmt(c.seconds)}{c.parts.length > 1 ? ` · ${c.parts.length} parts` : ""}</span>
          <Button size="sm" variant="outline" disabled={!!c.busy} onClick={() => transcribe(c)}><FileText className="size-4" /> Transcribe</Button>
          </div>
          {c.parts.map((p, i) => (
            <div key={p.url} className="flex items-center gap-2">
              {c.parts.length > 1 && <span className="w-12 text-xs text-muted-foreground">Part {i + 1}</span>}
              <audio controls src={p.url} className="h-8 flex-1" />
              <Button size="icon" variant="ghost" aria-label={`Download part ${i + 1}`} onClick={() => save(c, i)}><Download className="size-4" /></Button>
            </div>
          ))}
          {c.busy && <p className="text-xs text-muted-foreground">{c.busy}</p>}
          {c.error && <p className="text-sm text-destructive">{c.error}</p>}
          {c.transcript && (
            <div className="relative rounded-md bg-muted p-2 pr-9 text-sm whitespace-pre-wrap">
              {c.transcript}
              <Button size="icon" variant="ghost" className="absolute top-1 right-1 size-7" aria-label="Copy transcript" onClick={() => navigator.clipboard.writeText(c.transcript ?? "")}><Copy className="size-3.5" /></Button>
            </div>
          )}
        </div>
      ))}
    </div>
  );
}

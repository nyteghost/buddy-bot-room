import { useEffect, useRef, useState } from "react";
import { Copy, Download, FileText, Mic, Square, X } from "lucide-react";
import { Button } from "@/components/ui/button";

type Clip = { id: string; url: string; blob: Blob; at: Date; seconds: number; transcript?: string; busy?: boolean; error?: string };

/** Echo's recorder: records from the microphone only after the user presses Record. Clips stay in this browser tab. */
export function MicRecorder({ onClose }: { onClose: () => void }) {
  const [clips, setClips] = useState<Clip[]>([]);
  const [recording, setRecording] = useState(false);
  const [elapsed, setElapsed] = useState(0);
  const [error, setError] = useState("");
  const rec = useRef<MediaRecorder | null>(null);
  const started = useRef(0);

  useEffect(() => {
    if (!recording) return;
    const t = setInterval(() => setElapsed(Math.round((Date.now() - started.current) / 1000)), 500);
    return () => clearInterval(t);
  }, [recording]);
  useEffect(() => () => { rec.current?.state === "recording" && rec.current.stop(); }, []);

  async function start() {
    setError("");
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      const r = new MediaRecorder(stream);
      const chunks: Blob[] = [];
      r.ondataavailable = (e) => e.data.size && chunks.push(e.data);
      r.onstop = () => {
        stream.getTracks().forEach((t) => t.stop());
        const blob = new Blob(chunks, { type: r.mimeType || "audio/webm" });
        setClips((c) => [{ id: crypto.randomUUID(), url: URL.createObjectURL(blob), blob, at: new Date(), seconds: Math.round((Date.now() - started.current) / 1000) }, ...c]);
        setRecording(false);
      };
      started.current = Date.now(); setElapsed(0);
      r.start(); rec.current = r; setRecording(true);
    } catch (e) {
      setError((e as Error).name === "NotAllowedError" ? "Microphone access was blocked — allow it in your browser settings and try again." : `Could not start the microphone: ${(e as Error).message}`);
    }
  }

  const ext = (b: Blob) => (b.type.includes("mp4") ? "m4a" : b.type.includes("ogg") ? "ogg" : b.type.includes("wav") ? "wav" : "webm");
  const save = (c: Clip) => { const a = document.createElement("a"); a.href = c.url; a.download = `recording-${c.at.toISOString().slice(0, 19).replace(/[:T]/g, "-")}.${ext(c.blob)}`; a.click(); };

  const patch = (id: string, p: Partial<Clip>) => setClips((cs) => cs.map((c) => (c.id === id ? { ...c, ...p } : c)));
  async function transcribe(c: Clip) {
    patch(c.id, { busy: true, error: "", transcript: "" });
    try {
      const bytes = new Uint8Array(await c.blob.arrayBuffer());
      let bin = "";
      for (let i = 0; i < bytes.length; i += 0x8000) bin += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
      const res = await fetch("/api/transcribe", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ audio: btoa(bin), format: ext(c.blob) }) });
      if (!res.ok || !res.body) throw new Error((await res.json().catch(() => null))?.error ?? "The recording could not be transcribed.");
      const reader = res.body.pipeThrough(new TextDecoderStream()).getReader();
      let text = "";
      for (;;) { const { done, value } = await reader.read(); if (done) break; text += value; patch(c.id, { transcript: text }); }
      patch(c.id, { busy: false, transcript: text.trim() || "(no speech heard)" });
    } catch (e) { patch(c.id, { busy: false, error: (e as Error).message }); }
  }

  return (
    <div className="space-y-3 rounded-md border border-border bg-card p-3 text-card-foreground">
      <div className="flex items-center justify-between">
        <p className="text-sm font-medium">Echo's recorder</p>
        <Button size="icon" variant="ghost" aria-label="Close recorder" onClick={onClose}><X className="size-4" /></Button>
      </div>
      <div className="flex items-center gap-3">
        {recording
          ? <Button size="sm" variant="destructive" onClick={() => rec.current?.stop()}><Square className="size-4" /> Stop</Button>
          : <Button size="sm" onClick={start}><Mic className="size-4" /> Record</Button>}
        <span className="text-sm text-muted-foreground">{recording ? `Recording… ${elapsed}s` : "Press the page icon on a clip to transcribe it."}</span>
      </div>
      {error && <p className="text-sm text-destructive">{error}</p>}
      {clips.map((c) => (
        <div key={c.id} className="space-y-1">
          <div className="flex items-center gap-2">
          <audio controls src={c.url} className="h-8 flex-1" />
          <span className="text-xs text-muted-foreground">{c.seconds}s</span>
          <Button size="icon" variant="ghost" aria-label="Transcribe recording" disabled={c.busy} onClick={() => transcribe(c)}><FileText className="size-4" /></Button>
          <Button size="icon" variant="ghost" aria-label="Download recording" onClick={() => save(c)}><Download className="size-4" /></Button>
          </div>
          {c.busy && !c.transcript && <p className="text-xs text-muted-foreground">Transcribing…</p>}
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

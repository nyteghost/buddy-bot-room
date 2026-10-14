import { useEffect, useRef, useState } from "react";
import { Download, Mic, Square, X } from "lucide-react";
import { Button } from "@/components/ui/button";

type Clip = { id: string; url: string; blob: Blob; at: Date; seconds: number };

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

  const ext = (b: Blob) => (b.type.includes("mp4") ? "m4a" : b.type.includes("ogg") ? "ogg" : "webm");
  const save = (c: Clip) => { const a = document.createElement("a"); a.href = c.url; a.download = `recording-${c.at.toISOString().slice(0, 19).replace(/[:T]/g, "-")}.${ext(c.blob)}`; a.click(); };

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
        <span className="text-sm text-muted-foreground">{recording ? `Recording… ${elapsed}s` : "Recordings stay on this device."}</span>
      </div>
      {error && <p className="text-sm text-destructive">{error}</p>}
      {clips.map((c) => (
        <div key={c.id} className="flex items-center gap-2">
          <audio controls src={c.url} className="h-8 flex-1" />
          <span className="text-xs text-muted-foreground">{c.seconds}s</span>
          <Button size="icon" variant="ghost" aria-label="Download recording" onClick={() => save(c)}><Download className="size-4" /></Button>
        </div>
      ))}
    </div>
  );
}

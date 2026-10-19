import { useEffect, useRef, useState } from "react";
import { Mic, Square } from "lucide-react";

/** Dictation into the message box through your own Whisper server. Hidden unless the server reports it is ready. */
export function MicButton({ onText, disabled }: { onText: (text: string) => void; disabled?: boolean }) {
  const [enabled, setEnabled] = useState(false);
  const [state, setState] = useState<"idle" | "recording" | "sending">("idle");
  const [note, setNote] = useState("");
  const rec = useRef<MediaRecorder | null>(null);
  const chunks = useRef<Blob[]>([]);
  const timer = useRef<number | undefined>(undefined);

  useEffect(() => {
    let live = true;
    fetch("/api/stt").then((r) => r.json()).then((j: { enabled?: boolean }) => { if (live) setEnabled(j.enabled === true); }).catch(() => undefined);
    return () => { live = false; window.clearTimeout(timer.current); rec.current?.stream.getTracks().forEach((t) => t.stop()); };
  }, []);

  if (!enabled || typeof MediaRecorder === "undefined") return null;

  async function start() {
    setNote("");
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      const mime = ["audio/webm", "audio/mp4", "audio/ogg"].find((m) => MediaRecorder.isTypeSupported(m)) ?? "";
      const r = new MediaRecorder(stream, mime ? { mimeType: mime } : undefined);
      chunks.current = [];
      r.ondataavailable = (e) => { if (e.data.size) chunks.current.push(e.data); };
      r.onstop = async () => {
        stream.getTracks().forEach((t) => t.stop());
        const type = (r.mimeType || mime || "audio/webm").split(";")[0] ?? "audio/webm";
        setState("sending");
        try {
          const res = await fetch("/api/stt", { method: "POST", headers: { "content-type": type }, body: new Blob(chunks.current, { type }) });
          const json = (await res.json()) as { text?: string; error?: string };
          if (!res.ok) setNote(json.error ?? "Couldn't transcribe that.");
          else if (json.text) onText(json.text);
          else setNote("I didn't catch anything.");
        } catch { setNote("Couldn't reach the server."); }
        setState("idle");
      };
      rec.current = r;
      r.start();
      setState("recording");
      timer.current = window.setTimeout(() => r.state === "recording" && r.stop(), 60_000);
    } catch { setNote("Microphone blocked. Allow it in your browser's site settings."); setState("idle"); }
  }
  function stop() { window.clearTimeout(timer.current); if (rec.current?.state === "recording") rec.current.stop(); }

  return (
    <span className="mic-button-wrap">
      <button type="button" className="mic-button" data-state={state} disabled={disabled || state === "sending"} onClick={state === "recording" ? stop : start}
        aria-label={state === "recording" ? "Stop and transcribe" : "Dictate with your microphone"} title={state === "recording" ? "Stop and transcribe" : "Dictate"}>
        {state === "recording" ? <Square size={14} /> : <Mic size={14} />}
        {state === "sending" ? <small>…</small> : null}
      </button>
      {note ? <small className="mic-note" role="status">{note}</small> : null}
    </span>
  );
}

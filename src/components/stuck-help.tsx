import { useEffect, useRef, useState } from "react";
import { Button } from "./ui/button";
import { cleanStartStep, cleanStartTask } from "@/lib/focus-assist";
import { offlineStuckHelp, type StuckChoice, type StuckResult } from "@/lib/stuck-help";
export function StuckHelp({ task, step, onUseStep, disabled = false }: { task: string; step: string; onUseStep: (step: string) => void; disabled?: boolean }) {
  const [open, setOpen] = useState(false);
  const [result, setResult] = useState<StuckResult | null>(null);
  const [busy, setBusy] = useState(false);
  const pending = useRef<AbortController | null>(null);
  const cancel = () => { pending.current?.abort(); pending.current = null; setBusy(false); };
  useEffect(() => { cancel(); setResult(null); setOpen(false); return () => pending.current?.abort(); }, [task, step]);
  const choose = async (choice: StuckChoice) => {
    const valid = cleanStartTask(task); if (!valid) return;
    cancel();
    const controller = new AbortController(); pending.current = controller;
    setResult({ choice, text: offlineStuckHelp(valid, step, choice), source: "offline" }); setBusy(true);
    try {
      const response = await fetch("/api/focus-help", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ task: valid, step, choice }), signal: controller.signal });
      const data = await response.json() as Partial<StuckResult>;
      if (controller.signal.aborted || pending.current !== controller) return;
      if (response.ok && data.choice === choice && typeof data.text === "string" && data.text.trim() && data.text.length <= 1100)
        setResult({ choice, text: data.text, source: data.source === "local-ai" ? "local-ai" : "offline" });
    } catch { /* Keep the instant offline suggestion. */ }
    finally { if (pending.current === controller) { pending.current = null; setBusy(false); } }
  };
  return <div className="grid gap-2">
    <Button type="button" variant="outline" size="sm" disabled={disabled || !cleanStartTask(task)} aria-expanded={open} onClick={() => { if (open) cancel(); setOpen(!open); }}>I'm stuck</Button>
    {open && <section aria-label="Help when stuck" className="grid min-w-0 gap-3 rounded-lg border bg-muted/30 p-3">
      <p className="text-sm">What would help right now?</p>
      <div className="flex flex-wrap gap-2">
        <Button type="button" size="sm" variant="outline" disabled={disabled} onClick={() => void choose("smaller")}>Make it smaller</Button>
        <Button type="button" size="sm" variant="outline" disabled={disabled} onClick={() => void choose("explain")}>Explain it</Button>
        <Button type="button" size="sm" variant="outline" disabled={disabled} onClick={() => void choose("sample")}>Show a sample</Button>
      </div>
      <p className="text-xs text-muted-foreground">Choosing sends only this task and step to your configured Local AI. Offline help appears immediately. Nothing is changed or sent to other apps.</p>
      {result && <div className="grid min-w-0 gap-2" aria-live="polite">
        <p className="text-xs text-muted-foreground">{busy ? "Offline help ready; Local AI is refining…" : result.source === "local-ai" ? "Local AI suggestion — review before using" : "Offline suggestion"}</p>
        <p className="whitespace-pre-wrap break-words text-sm">{result.text}</p>
        {result.choice === "smaller" && <Button type="button" size="sm" disabled={disabled} onClick={() => { const next = cleanStartStep(result.text); if (next) { cancel(); onUseStep(next); setOpen(false); } }}>Use this smaller step</Button>}
        {busy && <Button type="button" size="sm" variant="ghost" onClick={cancel}>Keep offline help</Button>}
      </div>}
      <Button type="button" size="sm" variant="ghost" onClick={() => { cancel(); setOpen(false); }}>Close help</Button>
    </section>}
  </div>;
}

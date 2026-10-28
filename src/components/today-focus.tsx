import { useEffect, useState } from "react";
import { Check, Plus, Square, Timer } from "lucide-react";
import { Button } from "@/components/ui/button";
import { useCalmInterval } from "@/lib/power";
import { FOCUS_CHOICES, focusLeftMs, type Focus } from "@/lib/today";

type Run = (label: string, body: Record<string, unknown>) => Promise<void>;
const clock = (ms: number) => { const t = Math.floor(Math.abs(ms) / 1000); return `${Math.floor(t / 60)}:${String(t % 60).padStart(2, "0")}`; };

/** The running focus session: time left, and three ways out. Check-ins also go to your phone at halfway and at the end. */
export function FocusCard({ focus, busy, run }: { focus: Focus | null; busy: boolean; run: Run }) {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => { if (focus) setNow(Date.now()); }, [focus]);
  // The countdown redraws each second while you can see it; it recomputes from the clock when you come back.
  useCalmInterval(() => setNow(Date.now()), 1000, !!focus, false);
  if (!focus) return null;
  const left = focusLeftMs(focus, now);
  const over = left <= 0;
  const pct = Math.min(100, Math.max(0, 100 - (left / (focus.mins * 60_000)) * 100));
  return (
    <section aria-label="Focus session" className={`grid gap-3 rounded-lg border-2 p-4 ${over ? "border-destructive/60 bg-destructive/10" : "border-primary bg-primary/10"}`}>
      <div className="flex items-center gap-2 text-xs uppercase tracking-wide text-muted-foreground"><Timer className="size-4" /> {over ? "Time's up" : "Focusing"}</div>
      <div className="text-lg font-semibold leading-snug">{focus.title}</div>
      <div className="text-4xl font-bold tabular-nums" role="timer" aria-live="off">{over ? "+" : ""}{clock(left)}</div>
      <div className="h-2 overflow-hidden rounded-full bg-muted" aria-hidden="true"><div className="h-full bg-primary transition-[width]" style={{ width: `${pct}%` }} /></div>
      {over && <p className="text-sm">Done, need more time, or switching? Any of those is fine.</p>}
      <div className="flex flex-wrap gap-2">
        <Button className="h-12" disabled={busy} onClick={() => void run("done", { op: "done", id: focus.id })}><Check className="size-4" /> Done</Button>
        <Button variant="outline" className="h-12" disabled={busy} onClick={() => void run("focus", { op: "focus_more", mins: 10 })}><Plus className="size-4" /> 10 min</Button>
        <Button variant="ghost" className="h-12" disabled={busy} onClick={() => void run("focus", { op: "focus_stop" })}><Square className="size-4" /> Stop</Button>
      </div>
    </section>
  );
}

/** Start a focus session on a task: 15, 25 or 45 minutes (the task's own length is used when it fits). */
export function FocusStart({ id, mins, busy, run }: { id: string; mins?: number; busy: boolean; run: Run }) {
  return (
    <div className="flex flex-wrap items-center gap-1 text-sm">
      <span className="mr-1 flex items-center gap-1 text-muted-foreground"><Timer className="size-4" /> Focus</span>
      {FOCUS_CHOICES.map((m) => <Button key={m} size="sm" variant={mins === m ? "default" : "outline"} className="h-10 min-w-12" disabled={busy} onClick={() => void run("focus", { op: "focus_start", id, mins: m })}>{m}</Button>)}
      <span className="text-muted-foreground">min</span>
    </div>
  );
}

import { useEffect, useRef, useState } from "react";
import "./focus-companion-size.css";
import { Bookmark, Check, ChevronDown, Coffee, Play, RotateCcw, X, FileText } from "lucide-react";
import { Button } from "@/components/ui/button";
import { agents, agentName } from "@/lib/agents";
import { PixelCharacter } from "./pixel-character";
import { TinyWins } from "./tiny-wins";
import { hasFacingArt } from "@/lib/pal-art";
import { cleanStartStep, fallbackStartStep, whatCountsAsDone } from "@/lib/focus-assist";
import { COMPANION_MODES, FOCUS_CHECKPOINT_KEY, companionActivity, readFocusCheckpoint, type CompanionMode, type FocusSession } from "@/lib/focus-companion";
import { useCharacterMode } from "@/lib/hellraiser";

type Props = { session: FocusSession | null; onChange: (value: FocusSession | null) => void; paused?: boolean; onPauseChange?: (paused: boolean) => void };
const modeNames: Record<CompanionMode, string> = {
  quiet: "Quiet company", checkins: "Gentle check-ins", steps: "Step-by-step",
};

/** Optional, nonmodal body double: the rest of Pixel Pals stays usable. */
export function FocusCompanion({ session, onChange, paused = false, onPauseChange }: Props) {
  const [saved, setSaved] = useState<FocusSession | null>(null);
  const [checkin, setCheckin] = useState(false);
  const [busy, setBusy] = useState(false);
  const [note, setNote] = useState("");
  const [celebrationToken, setCelebrationToken] = useState(0);
  const [workDraft, setWorkDraft] = useState("");
  const [workSource, setWorkSource] = useState("");
  const [workBusy, setWorkBusy] = useState(false);
  const workPending = useRef<AbortController | null>(null);
  const [workNote, setWorkNote] = useState("");
  const pending = useRef<AbortController | null>(null);
  const theme = useCharacterMode();
  useEffect(() => {
    try { setSaved(readFocusCheckpoint(localStorage.getItem(FOCUS_CHECKPOINT_KEY))); }
    catch { setSaved(null); }
  }, []);
  useEffect(() => () => { pending.current?.abort(); workPending.current?.abort(); }, []);
  useEffect(() => { workPending.current?.abort(); setWorkDraft(""); setWorkSource(""); setWorkNote(""); setWorkBusy(false); }, [session?.task]);
  useEffect(() => {
    setCheckin(false);
    if (session?.mode !== "checkins" || paused) return;
    const timer = window.setInterval(() => {
      if (!document.hidden) setCheckin(true);
    }, 10 * 60 * 1000);
    return () => window.clearInterval(timer);
  }, [session?.mode, session?.task, paused]);

  const save = () => {
    if (!session) return;
    try {
      localStorage.setItem(FOCUS_CHECKPOINT_KEY, JSON.stringify(session));
      setSaved(session);
      setNote("Your place is saved in this browser. You can resume another day.");
    } catch { setNote("This browser could not save your place."); }
  };
  const forget = () => {
    try { localStorage.removeItem(FOCUS_CHECKPOINT_KEY); }
    catch { /* Optional browser storage */ }
    setSaved(null);
  };
  const end = () => { pending.current?.abort(); pending.current = null; setBusy(false); setNote(""); forget(); onChange(null); };
  const workTogether = async () => {
    if (!session || workBusy) return;
    workPending.current?.abort();
    const controller = new AbortController();
    workPending.current = controller;
    setWorkBusy(true);
    setWorkNote("Making a small example with local AI when available…");
    try {
      const response = await fetch("/api/pal-work", { method:"POST", headers:{"content-type":"application/json"},
        body:JSON.stringify({task:session.task}),signal:controller.signal });
      if (!response.ok) throw new Error("Unavailable");
      const value = await response.json() as {draft?:string;source?:string};
      if (controller.signal.aborted || workPending.current !== controller) return;
      setWorkDraft((value.draft ?? "").slice(0,1100));
      setWorkSource(value.source === "local-ai" ? "Local AI draft" : "Offline example");
      setWorkNote("Review or edit it yourself before using it. Nothing was changed or sent.");
    } catch {
      if (!controller.signal.aborted) setWorkNote("Couldn't reach local help. Your focus steps still work offline.");
    } finally {
      if (workPending.current === controller) { workPending.current = null; setWorkBusy(false); }
    }
  };
  const nextStep = async () => {
    if (!session || busy || paused) return;
    pending.current?.abort();
    const controller = new AbortController();
    pending.current = controller;
    const previous = session.step;
    const completed = [...session.completed, previous].slice(-8);
    const stepNumber = Math.min(999, session.stepNumber + 1);
    const next = { ...session, completed, stepNumber };
    onChange(next);
    setCelebrationToken((n) => n + 1);
    setBusy(true);
    setCheckin(false);
    setNote("Finding one more small step…");
    try {
      const response = await fetch("/api/just-start", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ task: session.task, action: "next", previous, stepNumber, completed: completed.slice(-4) }),
        signal: controller.signal,
      });
      if (!response.ok) throw new Error("Unavailable");
      const data = await response.json() as { step?: string; source?: string };
      if (controller.signal.aborted || pending.current !== controller) return;
      onChange({ ...next, step: cleanStartStep(data.step) ?? fallbackStartStep(session.task, "next", previous, stepNumber) });
      setNote(data.source === "local-ai" ? "Your Pal suggested a small next step." : "A quick step you can use without Local AI.");
    } catch {
      if (!controller.signal.aborted) {
        onChange({ ...next, step: fallbackStartStep(session.task, "next", previous, stepNumber) });
        setNote("Local AI is unavailable, so here's a simple next step.");
      }
    } finally {
      if (pending.current === controller) { pending.current = null; setBusy(false); }
    }
  };

  if (!session && !saved) return null;
  if (!session && saved) return (
    <aside className="focus-companion focus-companion-saved" aria-label="Saved Focus Assist checkpoint">
      <div className="flex items-center justify-between gap-2">
        <strong className="text-sm"><Bookmark className="mr-1 inline size-4" /> Where was I?</strong>
        <Button variant="ghost" size="sm" aria-label="Forget saved place" onClick={forget}><X className="size-4" /></Button>
      </div>
      <p className="text-sm font-medium">{saved.task}</p>
      <p className="text-xs text-muted-foreground">Step {saved.stepNumber}: {saved.step}</p>
      <Button size="sm" onClick={() => { onChange(saved); setNote(""); }}>Resume with {agentName(saved.pal, false, false, theme)}</Button>
      <p className="text-xs text-muted-foreground">Saved in this browser only.</p>
    </aside>
  );

  if (!session) return null;
  const pal = agents.find((a) => a.id === session.pal);
  const name = agentName(session.pal, false, false, theme);
  return (
    <aside className="focus-companion" aria-label="Focus Assist work companion">
      <div className="flex items-start gap-2">
        <div className={`focus-companion-pal${hasFacingArt(session.pal) ? " focus-companion-pal-directional" : ""}`} aria-hidden="true"><PixelCharacter id={session.pal} mode={theme} animated /></div>
        <div className="min-w-0 flex-1">
          <p className="text-sm font-semibold">{name} is here with you</p>
          <p className="text-xs text-muted-foreground">{pal?.role} · Illustrated body double</p>
          <div className="focus-companion-activity"><span className="focus-companion-pulse" /> {paused ? "Taking a break with you" : companionActivity(session.task)}</div>
        </div>
        <Button variant="ghost" size="sm" aria-label="Pause companion" title="Pause companion" onClick={() => { pending.current?.abort(); onChange(null); }}><X className="size-4" /></Button>
      </div>
      <p className="text-xs font-semibold text-muted-foreground">{paused ? "On a break from" : "Working alongside you on"}</p>
      <p className="text-sm font-medium focus-companion-task">{session.task}</p>
      <div className="focus-companion-step">
        <p className="text-xs text-muted-foreground">Step {session.stepNumber} · Your next tiny step</p>
        <p className="text-sm">{session.step}</p>
        <p className="text-xs text-muted-foreground"><strong>What counts as done?</strong> {whatCountsAsDone(session.step)}</p>
      </div>
      {session.completed.length > 0 && <TinyWins completed={session.completed} celebrationToken={celebrationToken} compact />}
      {session.mode === "steps" && <p className="text-xs text-muted-foreground">When you finish this step, ask for just one more. No whole-task pressure.</p>}
      {checkin && <div className="focus-companion-checkin" role="status">
        <p className="text-sm">Still here with you. Keep going, take a break, or save your place.</p>
        <Button variant="ghost" size="sm" onClick={() => setCheckin(false)}>I'm okay</Button>
      </div>}
      <div className="flex flex-wrap gap-2">
        <Button size="sm" disabled={busy || paused} onClick={() => void nextStep()}><Check className="size-4" /> Done with step</Button>
        {onPauseChange && <Button variant="outline" size="sm" onClick={() => onPauseChange(!paused)}>{paused ? <Play className="size-4" /> : <Coffee className="size-4" />}{paused ? " I am back" : " Break together"}</Button>}
        <Button variant="outline" size="sm" onClick={save}><Bookmark className="size-4" /> Save my place</Button>
        <Button variant="outline" size="sm" disabled={workBusy || paused} onClick={() => void workTogether()}><FileText className="size-4" /> {workBusy ? "Preparing…" : "Pal: make a sample"}</Button>
      </div>
      {workDraft && <section className="grid gap-2 rounded-md border p-2" aria-label="Pal's sample work">
        <p className="text-xs font-semibold">{workSource} · Sample work beside you</p>
        <textarea readOnly aria-label="Pal draft to review and copy" rows={5} className="w-full resize-y rounded-md border bg-background p-2 text-xs" value={workDraft} onFocus={e => e.currentTarget.select()} />
        <p className="text-xs text-muted-foreground">Copy or edit this manually. Your Pal cannot read, change or send anything from another app.</p>
      </section>}
      {workNote && <p className="text-xs text-muted-foreground" role="status">{workNote}</p>}
      <label className="focus-companion-mode text-xs text-muted-foreground">
        Companion style
        <span className="relative inline-flex items-center">
          <select value={session.mode} aria-label="Companion style" onChange={(e) => onChange({ ...session, mode: e.target.value as CompanionMode })}>
            {COMPANION_MODES.map((mode) => <option key={mode} value={mode}>{modeNames[mode]}</option>)}
          </select>
          <ChevronDown className="pointer-events-none absolute right-2 size-3" />
        </span>
      </label>
      {note && <p className="text-xs text-muted-foreground" role="status">{note}</p>}
      <div className="flex flex-wrap items-center justify-between gap-2">
        <span className="text-xs text-muted-foreground">{session.completed.length} step(s) marked done · Check-ins {session.mode === "checkins" ? "every 10 minutes" : "off"}</span>
        <Button variant="ghost" size="sm" onClick={end}><RotateCcw className="size-3.5" /> Finish & clear</Button>
      </div>
      <p className="text-xs text-muted-foreground">Your Pal's work is an animation, not access to your screen or files. Nothing is monitored or changed automatically.</p>
    </aside>
  );
}

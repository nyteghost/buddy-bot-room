import { useEffect, useRef, useState } from "react";
import { Bookmark, Check, ChevronDown, RotateCcw, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { agents, agentName } from "@/lib/agents";
import { PixelCharacter } from "./pixel-character";
import { cleanStartStep, fallbackStartStep } from "@/lib/focus-assist";
import { COMPANION_MODES, FOCUS_CHECKPOINT_KEY, companionActivity, readFocusCheckpoint, type CompanionMode, type FocusSession } from "@/lib/focus-companion";
import { useCharacterMode } from "@/lib/hellraiser";

type Props = { session: FocusSession | null; onChange: (value: FocusSession | null) => void };
const modeNames: Record<CompanionMode, string> = {
  quiet: "Quiet company", checkins: "Gentle check-ins", steps: "Step-by-step",
};

/** Optional, nonmodal body double: the rest of Pixel Pals stays usable. */
export function FocusCompanion({ session, onChange }: Props) {
  const [saved, setSaved] = useState<FocusSession | null>(null);
  const [checkin, setCheckin] = useState(false);
  const [busy, setBusy] = useState(false);
  const [note, setNote] = useState("");
  const pending = useRef<AbortController | null>(null);
  const theme = useCharacterMode();
  useEffect(() => {
    try { setSaved(readFocusCheckpoint(localStorage.getItem(FOCUS_CHECKPOINT_KEY))); }
    catch { setSaved(null); }
  }, []);
  useEffect(() => () => pending.current?.abort(), []);
  useEffect(() => {
    setCheckin(false);
    if (session?.mode !== "checkins") return;
    const timer = window.setInterval(() => {
      if (!document.hidden) setCheckin(true);
    }, 10 * 60 * 1000);
    return () => window.clearInterval(timer);
  }, [session?.mode, session?.task]);

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
  const nextStep = async () => {
    if (!session || busy) return;
    pending.current?.abort();
    const controller = new AbortController();
    pending.current = controller;
    const previous = session.step;
    const completed = [...session.completed, previous].slice(-8);
    const next = { ...session, completed };
    onChange(next);
    setBusy(true);
    setCheckin(false);
    setNote("Finding one more small step…");
    try {
      const response = await fetch("/api/just-start", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ task: session.task, action: "next", previous }),
        signal: controller.signal,
      });
      if (!response.ok) throw new Error("Unavailable");
      const data = await response.json() as { step?: string; source?: string };
      if (controller.signal.aborted || pending.current !== controller) return;
      onChange({ ...next, step: cleanStartStep(data.step) ?? fallbackStartStep(session.task, "next") });
      setNote(data.source === "local-ai" ? "Your Pal suggested a small next step." : "A quick step you can use without Local AI.");
    } catch {
      if (!controller.signal.aborted) {
        onChange({ ...next, step: fallbackStartStep(session.task, "next") });
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
      <p className="text-xs text-muted-foreground">Next: {saved.step}</p>
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
        <div className="focus-companion-pal" aria-hidden="true"><PixelCharacter id={session.pal} mode={theme} animated /></div>
        <div className="min-w-0 flex-1">
          <p className="text-sm font-semibold">{name} is here with you</p>
          <p className="text-xs text-muted-foreground">{pal?.role} · Illustrated body double</p>
          <div className="focus-companion-activity"><span className="focus-companion-pulse" /> {companionActivity(session.task)}</div>
        </div>
        <Button variant="ghost" size="sm" aria-label="Pause companion" title="Pause companion" onClick={() => { pending.current?.abort(); onChange(null); }}><X className="size-4" /></Button>
      </div>
      <p className="text-xs font-semibold text-muted-foreground">Working alongside you on</p>
      <p className="text-sm font-medium focus-companion-task">{session.task}</p>
      <div className="focus-companion-step">
        <p className="text-xs text-muted-foreground">Your next tiny step</p>
        <p className="text-sm">{session.step}</p>
      </div>
      {session.mode === "steps" && <p className="text-xs text-muted-foreground">When you finish this step, ask for just one more. No whole-task pressure.</p>}
      {checkin && <div className="focus-companion-checkin" role="status">
        <p className="text-sm">Still here with you. Keep going, take a break, or save your place.</p>
        <Button variant="ghost" size="sm" onClick={() => setCheckin(false)}>I'm okay</Button>
      </div>}
      <div className="flex flex-wrap gap-2">
        <Button size="sm" disabled={busy} onClick={() => void nextStep()}><Check className="size-4" /> Done with step</Button>
        <Button variant="outline" size="sm" onClick={save}><Bookmark className="size-4" /> Save my place</Button>
      </div>
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

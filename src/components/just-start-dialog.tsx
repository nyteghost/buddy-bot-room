import { useEffect, useId, useRef, useState } from "react";
import { Check, Clock3, RotateCcw, Sparkles, Users } from "lucide-react";
import { agents, agentName, type AgentId } from "@/lib/agents";
import { PixelCharacter } from "./pixel-character";
import { makeFocusSession, type CompanionMode, type FocusSession } from "@/lib/focus-companion";
import { useCharacterMode } from "@/lib/hellraiser";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { cleanStartStep, cleanStartTask, fallbackStartStep, type StartAction, type StartStage } from "@/lib/focus-assist";

const SESSION_KEY = "pixel-pals-just-start-v1";
type Saved = { task: string; step: string; stage: StartStage };
type StepResponse = { step?: string; source?: "local-ai" | "quick-start"; error?: string };
const readSaved = (): Saved | null => {
  try {
    const raw = sessionStorage.getItem(SESSION_KEY);
    if (!raw || raw.length > 1000) return null;
    const data = JSON.parse(raw) as Partial<Saved>;
    const task = cleanStartTask(data.task);
    if (!task || !["entry", "step", "started"].includes(data.stage ?? "")) return null;
    const stage = data.stage as StartStage;
    const step = cleanStartStep(data.step) ?? "";
    return { task, step, stage: stage === "entry" || step ? stage : "entry" };
  } catch { return null; }
};

/** Tiny, opt-in, local-first starting coach. Nothing is automatically added to Tasks
 * or sent to Mail/Calendar; the optional short session is stored in this tab only. */
export function JustStartDialog({ open, onOpenChange, initialTask = "", onCompanionStart }: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  initialTask?: string;
  onCompanionStart?: (session: FocusSession) => void;
}) {
  const theme = useCharacterMode();
  const [pal, setPal] = useState<AgentId>("byte");
  const [companionMode, setCompanionMode] = useState<CompanionMode>("quiet");
  const fieldId = useId();
  const [task, setTask] = useState("");
  const [step, setStep] = useState("");
  const [stage, setStage] = useState<StartStage>("entry");
  const [loaded, setLoaded] = useState(false);
  const [busy, setBusy] = useState(false);
  const [note, setNote] = useState("");
  const [timerUntil, setTimerUntil] = useState<number | null>(null);
  const [secondsLeft, setSecondsLeft] = useState(0);
  const [timerDone, setTimerDone] = useState(false);
  const pending = useRef<AbortController | null>(null);

  useEffect(() => {
    if (!open) { pending.current?.abort(); setLoaded(false); setTimerUntil(null); return; }
    const chosen = cleanStartTask(initialTask);
    const saved = chosen ? null : readSaved();
    setTask(chosen ?? saved?.task ?? "");
    setStep(saved?.step ?? "");
    setStage(saved?.stage ?? "entry");
    setNote("");
    setBusy(false);
    setTimerDone(false);
    setLoaded(true);
  }, [open, initialTask]);

  useEffect(() => {
    if (!open || !loaded) return;
    try {
      if (cleanStartTask(task)) sessionStorage.setItem(SESSION_KEY, JSON.stringify({ task, step, stage }));
      else sessionStorage.removeItem(SESSION_KEY);
    } catch { /* optional browser storage */ }
  }, [open, loaded, task, step, stage]);

  useEffect(() => () => pending.current?.abort(), []);
  useEffect(() => {
    if (!open || timerUntil === null) return;
    const update = () => {
      const remaining = Math.max(0, Math.ceil((timerUntil - Date.now()) / 1000));
      setSecondsLeft(remaining);
      if (remaining === 0) { setTimerUntil(null); setTimerDone(true); }
    };
    update();
    const id = window.setInterval(update, 500);
    return () => window.clearInterval(id);
  }, [open, timerUntil]);

  const close = (value: boolean) => {
    if (!value) { pending.current?.abort(); setTimerUntil(null); }
    onOpenChange(value);
  };

  const ask = async (action: StartAction) => {
    const validTask = cleanStartTask(task);
    if (!validTask) { setNote("Choose one thing to start first."); return; }
    pending.current?.abort();
    const controller = new AbortController();
    pending.current = controller;
    const previous = step;
    const quick = fallbackStartStep(validTask, action);
    setStep(quick);
    setStage("step");
    setNote("Here's something you can do now. Asking Local AI for a more specific step…");
    setBusy(true);
    try {
      const response = await fetch("/api/just-start", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ task: validTask, action, previous }),
        signal: controller.signal,
      });
      const data = await response.json() as StepResponse;
      if (controller.signal.aborted || pending.current !== controller) return;
      if (!response.ok) {
        setNote(data.error ?? "Local coaching isn't available. The quick step still works.");
        return;
      }
      setStep(cleanStartStep(data.step) ?? quick);
      setNote(data.source === "local-ai" ? "One small step from Local AI." : "A simple quick-start step (Local AI unavailable).");
    } catch {
      if (!controller.signal.aborted) setNote("Local AI couldn't connect. You can still use the quick-start step.");
    } finally {
      if (pending.current === controller) { pending.current = null; setBusy(false); }
    }
  };

  const changeTask = (next: string) => {
    pending.current?.abort(); pending.current = null;
    setTask(next); setStage("entry"); setStep(""); setNote(""); setBusy(false);
    setTimerUntil(null); setTimerDone(false);
  };

  const clear = () => {
    changeTask("");
    try { sessionStorage.removeItem(SESSION_KEY); } catch { /* optional */ }
  };

  return <Dialog open={open} onOpenChange={close}>
    <DialogContent className="max-h-[88vh] max-w-xl gap-4 overflow-y-auto" aria-describedby="just-start-description">
      <DialogHeader>
        <DialogTitle className="flex items-center gap-2"><Sparkles className="size-5 text-primary" /> Just Start</DialogTitle>
        <DialogDescription id="just-start-description">
          You don't need to finish anything. Let's find one small action to begin.
        </DialogDescription>
      </DialogHeader>
      <div className="grid gap-2">
        <label className="text-sm font-medium" htmlFor={fieldId}>What are you trying to start?</label>
        <textarea id={fieldId} aria-label="What are you trying to start?" value={task} maxLength={280} rows={2}
          onChange={(e) => changeTask(e.target.value)}
          placeholder="e.g. Finish tomorrow's show schedule"
          className="w-full min-w-0 resize-y rounded-md border bg-background p-3 text-sm focus-visible:outline-2 focus-visible:outline-ring" />
      </div>
      {stage === "entry" ? (
        <Button className="w-full" disabled={!cleanStartTask(task)} onClick={() => void ask("first")}>
          <Sparkles className="size-4" /> Help me start
        </Button>
      ) : (
        <section className="grid gap-3 rounded-lg border bg-muted/30 p-3" aria-label="Your next small step">
          <div className="flex items-center justify-between gap-2">
            <span className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">One small step</span>
            {busy && <span role="status" className="text-xs text-muted-foreground">Refining…</span>}
          </div>
          <p className="text-base font-medium leading-relaxed" aria-live="polite">{step}</p>
          {stage === "started" ? (
            <div className="grid gap-2">
              <p className="text-sm text-muted-foreground"><Check className="mr-1 inline size-4" /> You started. That counts. Continuing is optional.</p>
              <Button className="w-fit" variant="outline" onClick={() => void ask("next")}>One more small step</Button>
            </div>
          ) : (
            <div className="flex flex-wrap gap-2">
              <Button onClick={() => { pending.current?.abort(); pending.current = null; setBusy(false); setStage("started"); setNote(""); }}><Check className="size-4" /> I started</Button>
              <Button variant="outline" onClick={() => void ask("smaller")}>Smaller step</Button>
              <Button variant="outline" onClick={() => void ask("stuck")}>I'm stuck</Button>
            </div>
          )}
        </section>
      )}
      {stage !== "entry" && (
        <div className="flex flex-wrap items-center gap-2 border-t pt-2">
          <span className="text-xs text-muted-foreground">How was that step?</span>
          <Button variant="ghost" size="sm" disabled={busy} onClick={() => void ask("smaller")}>Too big</Button>
          <Button variant="ghost" size="sm" onClick={() => setNote("Good to know. You can keep going at your own pace.")}>That helped</Button>
          <Button variant="ghost" size="sm" disabled={busy} onClick={() => void ask("alternate")}>Try another approach</Button>
        </div>
      )}
      {stage === "started" && onCompanionStart && (
        <section className="grid gap-3 rounded-lg border p-3" aria-label="Start Together">
          <div>
            <p className="flex items-center gap-2 text-sm font-semibold"><Users className="size-4" /> Start Together</p>
            <p className="text-xs text-muted-foreground">Choose a Pal to work alongside you while you use Pixel Pals.</p>
          </div>
          <div className="flex items-center gap-3">
            <PixelCharacter id={pal} mode={theme} className="!h-14 !w-14 shrink-0" animated />
            <label className="grid flex-1 gap-1 text-xs" htmlFor="focus-pal-choice">Your work buddy
              <select id="focus-pal-choice" className="w-full rounded-md border bg-background px-2 py-2 text-sm" value={pal} onChange={(e) => setPal(e.target.value as AgentId)}>
                {agents.map((a) => <option key={a.id} value={a.id}>{agentName(a.id, false, false, theme)}</option>)}
              </select>
            </label>
          </div>
          <div className="grid gap-1">
            <label htmlFor="focus-companion-mode" className="text-xs">How should your Pal accompany you?</label>
            <select id="focus-companion-mode" className="w-full rounded-md border bg-background px-2 py-2 text-sm" value={companionMode} onChange={(e) => setCompanionMode(e.target.value as CompanionMode)}>
              <option value="quiet">Quiet company (no check-ins)</option>
              <option value="checkins">Gentle check-ins (every 10 minutes)</option>
              <option value="steps">Step-by-step (you control each next step)</option>
            </select>
          </div>
          <Button onClick={() => {
            const session = makeFocusSession(task, step, pal, companionMode);
            if (session) { onCompanionStart(session); close(false); }
          }}><Users className="size-4" /> Stay with me</Button>
          <p className="text-xs text-muted-foreground">Animated companionship, not screen tracking. Your Pal cannot see or change work in other apps. Saving your place is always your choice.</p>
        </section>
      )}
      {stage !== "entry" && (
        <div className="flex flex-wrap items-center gap-2 text-sm">
          <Clock3 className="size-4 text-muted-foreground" />
          {timerUntil !== null ? (
            <>
              <output aria-label="Time remaining" className="font-mono tabular-nums">{Math.floor(secondsLeft / 60)}:{String(secondsLeft % 60).padStart(2, "0")}</output>
              <Button variant="ghost" size="sm" onClick={() => { setTimerUntil(null); setTimerDone(false); }}>Stop timer</Button>
            </>
          ) : (
            <>
              <Button variant="outline" size="sm" onClick={() => { setTimerUntil(Date.now() + 120_000); setTimerDone(false); }}>Optional 2-minute timer</Button>
              {timerDone && <span className="text-muted-foreground">Two minutes are up. You can stop or continue.</span>}
            </>
          )}
        </div>
      )}
      {note && <p className="text-xs text-muted-foreground" role="status">{note}</p>}
      <div className="flex flex-wrap items-center justify-between gap-2 border-t pt-3">
        <p className="max-w-64 text-xs text-muted-foreground">Your progress stays in this tab. Local AI is optional; no task is changed automatically.</p>
        <Button variant="ghost" size="sm" onClick={clear}><RotateCcw className="size-3.5" /> New start</Button>
      </div>
    </DialogContent>
  </Dialog>;
}

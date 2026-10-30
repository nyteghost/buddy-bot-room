import { useEffect, useMemo, useState } from "react";
import "./focus-hub.css";
import { ArrowRight, Brain, Clock3, Coffee, MessageCircle, Moon, Play, RotateCcw, Sparkles, Sun } from "lucide-react";
import { Button } from "@/components/ui/button";
import { useWorkbench } from "@/lib/workbench";
import { chooseFocusTask, type Energy } from "@/lib/focus-pick";
import { zoneDateKey } from "@/lib/day-overview";

const NOTE_KEY = "pixel-pals-daily-note-v1";
type DailyNote = { day: string; morning: string; shutdown: string };
function safeNote(raw: string | null, today: string): DailyNote {
  if (!raw || raw.length > 3000) return { day: today, morning: "", shutdown: "" };
  try {
    const note = JSON.parse(raw) as Partial<DailyNote>;
    return note.day === today && typeof note.morning === "string" && typeof note.shutdown === "string"
      ? { day: today, morning: note.morning.slice(0, 800), shutdown: note.shutdown.slice(0, 800) }
      : { day: today, morning: "", shutdown: "" };
  } catch { return { day: today, morning: "", shutdown: "" }; }
}

/** One clear action, without automatic task mutations or opaque model recommendations. */
export function FocusHub({ onStart, onBrainDump, onOpenTasks, onOpenMail }: {
  onStart: (task: string) => void;
  onBrainDump: () => void;
  onOpenTasks: () => void;
  onOpenMail?: () => void;
}) {
  const { todos } = useWorkbench();
  const [energy, setEnergy] = useState<Energy>("steady");
  const [minutes, setMinutes] = useState(15);
  const [skipped, setSkipped] = useState<string[]>([]);
  const [now, setNow] = useState(() => Date.now());
  const [restUntil, setRestUntil] = useState<number | null>(null);
  const [showPlanning, setShowPlanning] = useState(false);
  const zone = Intl.DateTimeFormat().resolvedOptions().timeZone || "UTC";
  const day = zoneDateKey(now, zone);
  const [note, setNote] = useState<DailyNote>({ day, morning: "", shutdown: "" });
  const [savedMessage, setSavedMessage] = useState("");
  useEffect(() => {
    try { setNote(safeNote(localStorage.getItem(NOTE_KEY), zoneDateKey(Date.now(), zone))); } catch { /* local data optional */ }
  }, [zone]);
  useEffect(() => {
    const timer = window.setInterval(() => setNow(Date.now()), 1000);
    return () => window.clearInterval(timer);
  }, []);
  useEffect(() => {
    if (note.day !== day) setNote({ day, morning: "", shutdown: "" });
  }, [day, note.day]);
  const pick = useMemo(() => chooseFocusTask(todos, { now, zone, minutes, energy, skipIds: skipped }), [todos, now, zone, minutes, energy, skipped]);
  const save = () => {
    try { localStorage.setItem(NOTE_KEY, JSON.stringify({ ...note, day })); setSavedMessage("Saved in this browser for today."); }
    catch { setSavedMessage("This browser couldn't store your note."); }
  };
  const seconds = restUntil === null ? 0 : Math.max(0, Math.ceil((restUntil - now) / 1000));
  return (
    <section className="focus-hub" aria-label="ADHD home and task picker">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div>
          <h3 className="flex items-center gap-2 text-sm font-semibold"><Sparkles className="size-4 text-primary" /> One thing at a time</h3>
          <p className="text-xs text-muted-foreground">You don't have to plan everything before you begin.</p>
        </div>
        <Button size="sm" variant="ghost" onClick={onBrainDump}><Brain className="size-3.5" /> Brain Dump</Button>
      </div>
      <div className="flex flex-wrap items-center gap-2 text-xs">
        <label className="flex items-center gap-1">Energy
          <select className="rounded-md border bg-background p-1.5" value={energy} aria-label="Your energy today" onChange={(e) => { setEnergy(e.target.value as Energy); setSkipped([]); }}>
            <option value="low">Low</option><option value="steady">Steady</option><option value="high">Plenty</option>
          </select>
        </label>
        <label className="flex items-center gap-1">Available time
          <select className="rounded-md border bg-background p-1.5" value={minutes} aria-label="Available minutes" onChange={(e) => { setMinutes(Number(e.target.value)); setSkipped([]); }}>
            <option value={5}>5 min</option><option value={15}>15 min</option><option value={30}>30 min</option><option value={60}>1 hour</option>
          </select>
        </label>
        <span className="text-muted-foreground">Suggestions are local and adjustable.</span>
      </div>
      <div className="rounded-lg border bg-muted/40 p-3">
        {pick ? <>
          <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">Suggested next task</p>
          <p className="mt-1 break-words text-sm font-semibold">{pick.task.text}</p>
          <p className="mt-1 text-xs text-muted-foreground">{pick.reason} A first step can take less time than the whole task.</p>
          <div className="mt-3 flex flex-wrap items-center gap-2">
            <Button size="sm" onClick={() => onStart(pick.task.text)}><Play className="size-3.5" /> Help me start</Button>
            <Button size="sm" variant="outline" onClick={() => setSkipped((ids) => [...ids, pick.task.id])}><ArrowRight className="size-3.5" /> Another idea</Button>
            {skipped.length > 0 && <Button size="sm" variant="ghost" onClick={() => setSkipped([])}><RotateCcw className="size-3.5" /> Reset</Button>}
          </div>
        </> : <>
          <p className="text-sm font-semibold">{todos.some(t => !t.done) ? "You've seen the options. No pressure to choose one." : "Nothing is waiting on your list."}</p>
          <div className="mt-2 flex gap-2"><Button size="sm" variant="outline" onClick={() => { setSkipped([]); onBrainDump(); }}>Capture a thought</Button><Button size="sm" variant="ghost" onClick={onOpenTasks}>See all tasks</Button></div>
        </>}
      </div>
      <div className="flex flex-wrap items-center justify-between gap-2">
        <Button variant="ghost" size="sm" onClick={() => setRestUntil(restUntil === null ? Date.now() + 2 * 60_000 : null)}>
          <Coffee className="size-3.5" /> {restUntil === null ? "Gentle 2-minute pause" : seconds ? "Pause: " + Math.floor(seconds / 60) + ":" + String(seconds % 60).padStart(2, "0") : "Pause complete — return whenever"}
        </Button>
        <Button variant="ghost" size="sm" onClick={() => setShowPlanning(!showPlanning)} aria-expanded={showPlanning}>
          {showPlanning ? "Hide" : "Open"} daily check-in <Sun className="size-3.5" />
        </Button>
      </div>
      {showPlanning && (
        <div className="grid gap-2 rounded-lg border p-3">
          <label className="grid gap-1 text-xs"><span className="flex gap-1 items-center"><Sun className="size-3.5" /> Morning: What's one useful thing today?</span>
            <textarea className="min-h-14 resize-y rounded-md border bg-background p-2 text-sm" maxLength={800} value={note.morning} onChange={e => { setNote(v => ({...v,morning:e.target.value})); setSavedMessage(""); }} placeholder="A single priority is enough." />
          </label>
          <label className="grid gap-1 text-xs"><span className="flex gap-1 items-center"><Moon className="size-3.5" /> Before you stop: Where should you resume?</span>
            <textarea className="min-h-14 resize-y rounded-md border bg-background p-2 text-sm" maxLength={800} value={note.shutdown} onChange={e => { setNote(v => ({...v,shutdown:e.target.value})); setSavedMessage(""); }} placeholder="Next time, start by opening..." />
          </label>
          <div className="flex flex-wrap gap-2"><Button size="sm" variant="outline" onClick={save}>Save today's note</Button><Button size="sm" variant="ghost" onClick={onOpenMail}><MessageCircle className="size-3.5" /> Review mail</Button></div>
          {savedMessage && <p role="status" className="text-xs text-muted-foreground">{savedMessage}</p>}
          <p className="text-xs text-muted-foreground">Private to this browser. No automatic messages, reminders, or emails.</p>
        </div>
      )}
    </section>
  );
}

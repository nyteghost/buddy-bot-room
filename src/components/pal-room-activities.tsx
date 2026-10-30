import { useEffect, useRef, useState } from "react";
import { Coffee, Sparkles, Play, Users, Moon, PartyPopper } from "lucide-react";
import { Button } from "@/components/ui/button";
import { PixelCharacter } from "./pixel-character";
import { TinyWins } from "./tiny-wins";
import { agentName, type AgentId } from "@/lib/agents";
import { palActivity } from "@/lib/pal-room-life";
import { companionActivity, type FocusSession } from "@/lib/focus-companion";
import { useCharacterMode } from "@/lib/hellraiser";
import "./pal-room-activities.css";

export function PalRoomActivities({ session, onStart, onPauseChange, paused, playful, onPlayfulChange, phase }: {
  session: FocusSession | null;
  onStart: () => void;
  onPauseChange: (value: boolean) => void;
  paused: boolean;
  playful: boolean;
  onPlayfulChange: (value: boolean) => void;
  phase: number;
}) {
  const theme = useCharacterMode();
  const [celebrationToken, setCelebrationToken] = useState(0);
  const last = useRef<{ task: string; stepNumber: number } | null>(null);
  useEffect(() => {
    if (!session) { last.current = null; return; }
    const before = last.current;
    if (before?.task === session.task && session.stepNumber > before.stepNumber) {
      setCelebrationToken((value) => value + 1);
    }
    last.current = { task: session.task, stepNumber: session.stepNumber };
  }, [session?.task, session?.stepNumber]);
  const [celebrating, setCelebrating] = useState(false);
  useEffect(() => {
    if (!celebrationToken) return;
    setCelebrating(true);
    const timer = window.setTimeout(() => setCelebrating(false), 2600);
    return () => window.clearTimeout(timer);
  }, [celebrationToken]);
  const id = session?.pal ?? "byte";
  const name = agentName(id, false, false, theme);
  const working = !!session && !paused;
  const resting = !!session && paused;
  const ambientPals: AgentId[] = ["byte", "sage", "saiyan"];
  return (
    <section className="pal-room-activities" aria-label="Pal Room activities">
      <div className="pal-room-illustration" data-activity={resting ? "break" : working && celebrating ? "celebrating" : working ? "working" : "idle"} aria-hidden="true">
        <div className="pal-room-prop">{resting ? "☕" : celebrating ? "✨" : working ? "💻" : "✨"}</div>
        <PixelCharacter id={id} mode={theme} walking={working} animated={!resting} />
        <div className="pal-room-surface" />
      </div>
      <div className="min-w-0 flex-1">
        <h3 className="text-sm font-semibold">{working ? name + " is working beside you" : resting ? name + " is taking a break with you" : "The Pals are ready when you are"}</h3>
        <p className="mt-1 text-xs text-muted-foreground">{working ? companionActivity(session!.task) : resting ? "No rush. Your place is still here when you return." : "Invite a Pal to a tiny first step, or just enjoy the room."}</p>
        {session && <p className="mt-1 truncate text-xs" title={session.task}>{session.task}</p>}
        {!!session?.completed.length && <div className="mt-2"><TinyWins compact completed={session.completed} celebrationToken={celebrationToken} /></div>}
        <div className="mt-2 flex flex-wrap gap-2">
          {!session ? (
            <Button type="button" size="sm" onClick={onStart}><Users className="size-3.5" /> Work with me</Button>
          ) : paused ? (
            <Button type="button" size="sm" onClick={() => onPauseChange(false)}><Play className="size-3.5" /> I'm back</Button>
          ) : (
            <Button type="button" size="sm" variant="outline" onClick={() => onPauseChange(true)}><Coffee className="size-3.5" /> Break together</Button>
          )}
          {!session && <Button type="button" size="sm" variant="ghost" onClick={onStart}><Sparkles className="size-3.5" /> Just Start</Button>}
        </div>
      </div>
      <div className="pal-room-mood">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div>
            <p className="text-xs font-semibold">Room mood</p>
            <p className="text-xs text-muted-foreground">{playful ? "Pals take turns with little activities." : "Calm by default: a quieter room with fewer distractions."}</p>
          </div>
          <Button type="button" variant="outline" size="sm" aria-pressed={playful}
            aria-label={playful ? "Switch Pal Room to Calm" : "Switch Pal Room to Playful"}
            onClick={() => onPlayfulChange(!playful)}>
            {playful ? <Moon className="size-3.5" /> : <PartyPopper className="size-3.5" />}
            {playful ? "Calm" : "Playful"}
          </Button>
        </div>
        {playful && (
          <div className="pal-room-life-list" role="group" aria-label="What the Pals are doing">
            {ambientPals.map((pal) => {
              const action = palActivity(pal, phase);
              return <span key={pal} className="pal-room-life-chip" title={action.text}>
                <span aria-hidden="true">{action.emoji}</span>
                <strong>{agentName(pal, false, false, theme)}</strong>
                <span>{action.text}</span>
              </span>;
            })}
          </div>
        )}
      </div>
    </section>
  );
}

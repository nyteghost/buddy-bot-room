import { useEffect, useRef, useState } from "react";
import { Coffee, Sparkles, Play, Users, Moon, PartyPopper } from "lucide-react";
import { Button } from "@/components/ui/button";
import { PixelCharacter } from "./pixel-character";
import { TinyWins } from "./tiny-wins";
import { agentName, type AgentId } from "@/lib/agents";
import { palActivity } from "@/lib/pal-room-life";
import { companionActivity, type FocusSession } from "@/lib/focus-companion";
import { useCharacterMode } from "@/lib/hellraiser";
import { WorldCharacterLibrary } from "./world-character-library";
import { AdhdHandoffPanel } from "./adhd-handoff-panel";
import type { WorldCustomCharacter } from "@/lib/world-custom-packs";
import "./pal-room-activities.css";

export function PalRoomActivities({ session, onStart, onPauseChange, paused, playful, onPlayfulChange, phase, livingWorld, onLivingWorldChange, enabledWorldPacks, onWorldPackChange, customCharacters, syncStatus, onCustomSave, onCustomInstallPack, onCustomDelete, onWaveAll, onCelebrateWorld, onCustomInstallBackup, onCustomUpdatePack, onCustomExportBackup, recoveryBackup, animationsPaused }: {
  session: FocusSession | null;
  onStart: () => void;
  onPauseChange: (value: boolean) => void;
  paused: boolean;
  playful: boolean;
  onPlayfulChange: (value: boolean) => void;
  phase: number;
  livingWorld: boolean;
  onLivingWorldChange: (value:boolean)=>void;
  enabledWorldPacks: readonly string[];
  onWorldPackChange: (id:string,enabled:boolean)=>void;
  customCharacters: readonly WorldCustomCharacter[];
  syncStatus: string;
  onCustomSave: (character:WorldCustomCharacter)=>Promise<boolean>;
  onCustomInstallPack: (characters:WorldCustomCharacter[])=>Promise<boolean>;
  onCustomInstallBackup?: (characters:WorldCustomCharacter[])=>Promise<boolean>;
  onCustomUpdatePack?: (characters:WorldCustomCharacter[])=>Promise<boolean>;
  onCustomExportBackup?: ()=>Promise<string>;
  recoveryBackup?: string|null;
  animationsPaused?: boolean;
  onCustomDelete: (id:string)=>Promise<boolean>;
  onWaveAll: ()=>void;
  onCelebrateWorld: ()=>void;
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
        <PixelCharacter id={id} mode={theme} motion={resting ? "rest" : celebrating ? "celebrate" : working ? "work" : playful ? "look" : undefined} />
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
        <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
          <div><p className="text-xs font-semibold">World mode</p><p className="text-xs text-muted-foreground">{livingWorld ? "Animated Pals and living environments" : "Original Classic Pal Room"}</p></div>
          <Button size="sm" type="button" variant="outline" aria-label={livingWorld ? "Switch to Classic Pal Room" : "Switch to Living World"} aria-pressed={livingWorld} onClick={()=>onLivingWorldChange(!livingWorld)}>{livingWorld ? "Living World" : "Classic"}</Button>
        </div>
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
        {livingWorld && <div className="mb-2 flex flex-wrap gap-2">
          <Button type="button" size="sm" variant="outline" aria-label="Wave to all Pals" onClick={onWaveAll}><Sparkles className="size-3.5"/>Wave to everyone</Button>
          <Button type="button" size="sm" variant="outline" aria-label="Celebrate with Pals" onClick={onCelebrateWorld}><PartyPopper className="size-3.5"/>Celebrate together</Button>
        </div>}
        {livingWorld && <WorldCharacterLibrary enabledIds={enabledWorldPacks} customCharacters={customCharacters} syncStatus={syncStatus} onToggle={onWorldPackChange} onSave={onCustomSave} onInstallPack={onCustomInstallPack} onDelete={onCustomDelete} {...(onCustomInstallBackup ? {onInstallBackup:onCustomInstallBackup} : {})} {...(onCustomUpdatePack ? {onUpdatePack:onCustomUpdatePack} : {})} {...(onCustomExportBackup ? {onExportBackup:onCustomExportBackup} : {})} recoveryBackup={recoveryBackup??null} paused={animationsPaused??false} />}
        <AdhdHandoffPanel />
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

import { useEffect, useState } from "react";
import type { CSSProperties } from "react";
import type { AgentId } from "@/lib/agents";
import type { CharacterMode } from "@/lib/hellraiser";
import { officePose, officeStations } from "@/lib/office-motion";
import { cn } from "@/lib/utils";
import { PixelCharacter } from "./pixel-character";
import { ThinkingProp } from "./thinking-prop";

export function OfficePal({ id, index, mode, active, enabled }: {
  id: AgentId; index: number; mode: CharacterMode; active: boolean; enabled: boolean;
}) {
  const [elapsed, setElapsed] = useState(0);
  const [arrived, setArrived] = useState(false);
  useEffect(() => {
    if (!enabled || active || window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;
    const start = performance.now();
    const timer = window.setInterval(() => setElapsed(performance.now() - start), 160);
    return () => window.clearInterval(timer);
  }, [enabled, active]);
  useEffect(() => {
    setArrived(false);
    if (!active) return;
    const timer = window.setTimeout(() => setArrived(true), 1000);
    return () => window.clearTimeout(timer);
  }, [active]);
  const station = officeStations[id];
  const pose = officePose(id, index, elapsed);
  const working = active && arrived;
  const walking = enabled && (active ? !arrived : pose.walking);
  const position = {
    "--office-x": `${active ? station.home[0] : pose.x}%`,
    "--office-y": `${active ? station.home[1] : pose.y}%`,
  } as CSSProperties;
  return (
    <div
      style={position}
      className={cn("scene-pal office-pal", `agent-${id}`, active && "office-assigned", working && "office-working", walking && "office-walking", !active && pose.facingLeft && "office-facing-left", !enabled && "pal-away")}
      data-activity={working ? "working" : walking ? "walking" : "idle"}
      aria-label={`${station.label}: ${working ? station.activity : walking ? "walking to a station" : "at a station"}`}
    >
      {working && <div className="office-task-cue"><ThinkingProp id={id} mode={mode} /><span>{station.activity}</span></div>}
      <div className="office-character"><PixelCharacter id={id} mode={mode} walking={walking} /></div>
      <span>{station.label}</span>
    </div>
  );
}
import { useEffect, useState } from "react";
import type { CSSProperties } from "react";
import type { AgentId } from "@/lib/agents";
import type { CharacterMode } from "@/lib/hellraiser";
import { officePose, officeStations, type Heading } from "@/lib/office-motion";
import { hasFacingArt } from "@/lib/pal-art";
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
  const directional = hasFacingArt(id);
  const working = active && arrived;
  const walking = enabled && (active ? !arrived : pose.walking);
  // Seated whenever the pal is parked at its own desk chair.
  const seated = active ? arrived : !pose.walking && pose.x === station.home[0] && pose.y === station.home[1];
  const position = {
    "--office-x": `${active ? station.home[0] : pose.x}%`,
    "--office-y": `${active ? station.home[1] : pose.y}%`,
  } as CSSProperties;
  return (
    <div
      style={position}
      className={cn("scene-pal office-pal", `agent-${id}`, active && "office-assigned", working && "office-working", seated && "office-seated", seated && `office-seated-${station.facing}`, station.facing === "toward" && "office-front", walking && "office-walking", walking && !active && !directional && `office-dir-${pose.heading}`, directional && "office-directional", enabled && !active && !walking && seated && station.facing === "toward" && "office-idle", !active && !directional && pose.facingLeft && "office-facing-left", !enabled && "pal-away")}
      data-activity={working ? "working" : walking ? "walking" : "idle"}
      aria-label={`${station.label}: ${working ? station.activity : walking ? "walking to a station" : "at a station"}`}
    >
      {working && <div className="office-task-cue"><ThinkingProp id={id} mode={mode} /><span>{station.activity}</span></div>}
      <div className="office-character"><PixelCharacter id={id} mode={mode} walking={walking} back={!directional && seated && station.facing === "away"} facing={facingOf(directional, active, walking, seated, station.facing, pose.heading)} />{seated && station.facing === "away" && <ChairBack />}</div>
      <span>{station.label}</span>
    </div>
  );
}
/** Pixel chair back drawn in front of a seated pal so it reads as sitting at the desk. */
function ChairBack() {
  return (
    <svg className="office-chair" viewBox="0 0 16 9" shapeRendering="crispEdges" aria-hidden>
      <rect x="2" y="0" width="12" height="6" className="chair-back" />
      <rect x="3" y="1" width="10" height="1" className="chair-shine" />
      <rect x="7" y="6" width="2" height="2" className="chair-back" />
      <rect x="3" y="8" width="10" height="1" className="chair-back" />
    </svg>
  );
}

/** Which way a pal with directional art looks: the way it walks, toward the monitors when seated in the back row, otherwise at you. */
function facingOf(directional: boolean, active: boolean, walking: boolean, seated: boolean, side: "away" | "toward", heading: Heading): Heading | undefined {
  if (!directional) return undefined;
  if (active) return walking ? "n" : side === "away" ? "n" : "s";
  if (walking) return heading;
  return seated && side === "away" ? "n" : "s";
}

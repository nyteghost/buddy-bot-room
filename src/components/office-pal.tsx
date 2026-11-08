import { useEffect, useRef, useState } from "react";
import type { CSSProperties } from "react";
import { agentName, type AgentId } from "@/lib/agents";
import type { CharacterMode } from "@/lib/hellraiser";
import { officePose, officeStations, headingOf, type Heading } from "@/lib/office-motion";
import { worldDepthScale, worldDepthZ, worldPose, worldRoomPlan, type WorldPose } from "@/lib/world-navigation";
import { useWorldActor, useWorldFixtureUse } from "@/lib/world-presence";
import { useWorldPalSkin } from "@/lib/world-pal-skins";
import { WorldHdSkin } from "./world-hd-skin";
import { WORLD_CROWD_PRIORITY, useWorldCrowd, worldCrowdTieBreak, worldCrowdView } from "@/lib/world-crowd";
import { worldPalBody } from "@/lib/world-proportions";
import { WORLD_GAITS } from "@/lib/world-wander";
import { hasFacingArt } from "@/lib/pal-art";
import { cn } from "@/lib/utils";
import { ambientMotion, advanceMotionClock, type PalMotion } from "@/lib/pal-motion";
import { useReducedMotion } from "@/lib/reduced-motion";
import { useCalmInterval, lowPower } from "@/lib/power";
import { PixelCharacter } from "./pixel-character";
import { ThinkingProp } from "./thinking-prop";

export function OfficePal({ id, index, mode, active, enabled, playful = false, visible = true, world = false, cue, onInteract }: {
  id: AgentId; index: number; mode: CharacterMode; active: boolean; enabled: boolean; playful?: boolean; visible?: boolean; world?: boolean;
  cue?: PalMotion | undefined; onInteract?: ()=>void;
}) {
  const [elapsed, setElapsed] = useState(0);
  const [arrived, setArrived] = useState(false);
  const lastTick = useRef(0);
  const wasActive = useRef(active);
  const reduced = useReducedMotion();
  const low = lowPower.use();
  const wandering = visible && enabled && (playful || (world && active)) && !reduced && !low;
  // The walk is redrawn 10 times a second; it pauses in hidden windows, hidden tabs, low-power mode, or reduced motion.
  useEffect(() => { lastTick.current = performance.now(); }, [wandering]);
  const station = officeStations[id];
  const themeWorld=world && mode!=="linux" && mode!=="assistant" && mode!=="devteam";
  const sceneHome=themeWorld ? worldRoomPlan(mode).homes[index]! : {x:station.home[0],y:station.home[1]};
  // Living World crowd (world-crowd.ts): strolling Pals have right of way; Pals at a desk or in office choreography are fixed obstacles.
  const crowdMember = world && enabled && visible;
  const planned = crowdMember && themeWorld && !active && playful;
  const officeAt = !themeWorld && crowdMember && playful && !active ? officePose(id,index,elapsed) : null;
  const crowd = useWorldCrowd({ theme: mode, time: elapsed, active: wandering, fixedAt: planned || !crowdMember ? null : officeAt ? { x: officeAt.x, y: officeAt.y } : sceneHome,
    member: crowdMember ? { id: "pal:" + id, priority: WORLD_CROWD_PRIORITY.pal + worldCrowdTieBreak("pal:" + id), speed: WORLD_GAITS.humanoid.speed, scale: worldPalBody(id) === "object" ? 0.9 : 1,
      ...(planned ? { plan: (t: number) => { const p = worldPose(id, index, t, mode); return { x: p.x, y: p.y, walking: p.walking, facing: p.heading }; } } : {}) } : null });
  useCalmInterval(() => {
    const now = performance.now();
    const delta = now - lastTick.current;
    lastTick.current = now;
    if (planned) crowd.advance(delta);
    setElapsed(value => advanceMotionClock(value, delta));
  }, 100, wandering);
  useEffect(() => {
    if (wasActive.current && !active) setElapsed(-index * 4100);
    wasActive.current = active;
  }, [active, index]);
  useEffect(() => {
    setArrived(false);
    if (!active) return;
    const timer = window.setTimeout(() => setArrived(true), 1000);
    return () => window.clearTimeout(timer);
  }, [active]);
  const pose = themeWorld ? worldCrowdView(worldPose(id,index,crowd.pose?.time ?? elapsed,mode), planned ? crowd.pose : null, "heading") : officePose(id,index,elapsed);
  const directional = world || hasFacingArt(id);
  const displayLabel=world && mode!=="linux" && mode!=="assistant" && mode!=="devteam" ? agentName(id,mode==="hellraiser",mode==="horror",mode) : station.label;
  const atDesk = Math.hypot(pose.x - sceneHome.x, pose.y - sceneHome.y) < .2;
  const working = active && (arrived || reduced || atDesk);
  const x = active ? sceneHome.x : playful ? pose.x : sceneHome.x;
  const y = active ? sceneHome.y : playful ? pose.y : sceneHome.y;
  const walking = enabled && (active ? !working : wandering && pose.walking);
  const heading = active && walking ? headingOf(sceneHome.x - pose.x, sceneHome.y - pose.y) : pose.heading;
  // Seated whenever the pal is parked at its own desk chair.
  const seated = !themeWorld && (active ? working : !walking && x === sceneHome.x && y === sceneHome.y);
  // Themed Living World rooms place Pals by their feet on a calibrated floor, sorted by depth.
  const position = {
    "--office-x": `${x}%`,
    "--office-y": `${y}%`,
    ...(themeWorld ? { "--world-z": String(worldDepthZ(y)), "--world-depth-scale": String(worldDepthScale(y)) } : {}),
  } as CSSProperties;
  const strolling = themeWorld && enabled && visible && !active && wandering;
  // In themed rooms the pose always comes from worldPose (office choreography has no actions or furniture).
  const roomPose: WorldPose | null = themeWorld ? pose as WorldPose : null;
  useWorldFixtureUse("pal:" + id, mode, strolling && roomPose?.action === "work" ? roomPose.fixture : null);
  const { rootRef, labelRef, labelHidden } = useWorldActor("pal:" + id, x, y, !walking, world && enabled && visible, elapsed);
  // Opt-in HD256 look (Living World only; Classic mode and identity unaffected).
  const skin = useWorldPalSkin(id);
  const hdLook = world && enabled && skin ? skin : undefined;
  const worldAction: PalMotion | null = roomPose && roomPose.action !== "walk" && roomPose.action !== "idle" ? roomPose.action : null;
  return (
    <div
      style={position}
      className={cn("scene-pal office-pal", `agent-${id}`, active && "office-assigned", working && "office-working", seated && "office-seated", seated && `office-seated-${station.facing}`, station.facing === "toward" && "office-front", walking && "office-walking", walking && !directional && `office-dir-${heading}`, directional && "office-directional", enabled && !active && !walking && seated && station.facing === "toward" && "office-idle", !directional && (walking ? heading.includes("w") : !active && pose.facingLeft) && "office-facing-left", !enabled && "pal-away")}
      data-activity={working ? "working" : walking ? "walking" : "idle"}
      data-world-floor={themeWorld ? "feet" : undefined}
      role={world && enabled ? "button" : undefined}
      tabIndex={world && enabled ? 0 : undefined}
      onClick={world && enabled ? onInteract : undefined}
      onKeyDown={world && enabled ? e=>{if(e.key==="Enter"||e.key===" "){e.preventDefault();onInteract?.();}}:undefined}
      data-world-cue={cue ?? undefined}
      aria-label={`${displayLabel}: ${working ? "working" : walking ? "walking around the room" : "at a station"}${world&&enabled?". Activate to wave.":""}`}
    >
      {working && <div className="office-task-cue"><ThinkingProp id={id} mode={mode} /><span>{station.activity}</span></div>}
      <div className={cn("office-character", hdLook && "world-pal-hd")} ref={el => { rootRef.current = el; }}>{hdLook ? <WorldHdSkin character={hdLook} name={displayLabel} facing={walking ? heading : seated && station.facing === "away" ? "n" : pose.heading} walking={walking && !reduced} elapsed={elapsed} motion={cue ?? (worldAction ?? undefined)} /> : <PixelCharacter id={id} mode={mode} walking={walking && !reduced} motion={cue ?? (enabled && visible ? working ? "work" : playful && !low && !reduced ? worldAction ?? ambientMotion(id, Math.floor(elapsed / 6500)) : undefined : undefined)} pixelWorld={world} walkFrame={Math.floor(elapsed / 180) % 4} back={!directional && seated && station.facing === "away"} facing={facingOf(directional, active, walking, seated, station.facing, heading)} />}{seated && station.facing === "away" && <ChairBack />}</div>
      <span ref={el => { labelRef.current = el; }} className={labelHidden ? "world-label-hidden" : undefined}>{displayLabel}</span>
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
  if (active) return walking ? heading : side === "away" ? "n" : "s";
  if (walking) return heading;
  return seated && side === "away" ? "n" : "s";
}

import { useEffect, useMemo, useRef, useState, type CSSProperties } from "react";
import { useCalmInterval, lowPower } from "@/lib/power";
import { useReducedMotion } from "@/lib/reduced-motion";
import { advanceMotionClock } from "@/lib/pal-motion";
import { spriteRuns } from "@/lib/sprite-upscale";
import { worldFacingSprite } from "@/lib/world-facing-sprites";
import { worldReactionFrame } from "@/lib/world-animation";
import type { CharacterMode } from "@/lib/hellraiser";
import { worldDepthZ } from "@/lib/world-floor";
import { greenJacketPalette, greenJacketPose, greenJacketSprite, worldHideoutForTheme, worldCueReaction, type WorldRoomCue } from "@/lib/world-character-packs";

const originalArt=greenJacketSprite();
/** Purely visual visitor, independent from AI-agent identities and permissions. */
export function GreenJacketVisitor({ active, theme, cue }: { active:boolean; theme:CharacterMode; cue?:WorldRoomCue }) {
  const [elapsed,setElapsed]=useState(0);
  const previous=useRef(0);
  const reduced=useReducedMotion();
  const low=lowPower.use();
  const running=active&&!reduced&&!low;
  const reacting=!!cue&&!reduced&&!low;
  useEffect(()=>{previous.current=performance.now();},[running,reacting]);
  useCalmInterval(()=>{
    const now=performance.now(),delta=now-previous.current;
    previous.current=now;
    setElapsed(value=>advanceMotionClock(value,delta));
  },120,running||reacting);
  const time=running?elapsed:0;
  const pose=greenJacketPose(time);
  const frame=pose.walking?Math.floor(time/150)%4:0;
  const reaction=worldCueReaction(cue,"green-jacket",Date.now(),reduced||low);
  const runs=useMemo(()=>spriteRuns(reaction?worldReactionFrame(originalArt,pose.facing,reaction):worldFacingSprite(originalArt,pose.facing,frame),(x,y)=>y<24?"body":x<16?"left-leg":"right-leg"),[pose.facing,frame,reaction?.action,reaction?.frame]);
  // Center-anchored sprite: its feet sit roughly 8% lower than its position, which sets its depth.
  const style={"--world-visitor-x":pose.x+"%","--world-visitor-y":pose.y+"%","--world-visitor-scale":String(pose.scale),"--world-z":String(worldDepthZ(pose.y+8)),opacity:pose.opacity} as CSSProperties;
  return <>
    <div className={"world-visitor-hideout world-hideout-"+worldHideoutForTheme(theme)} style={{"--world-z":String(worldDepthZ(76))} as CSSProperties} aria-hidden="true"/>
    <div className="world-visitor" style={style} data-action={reaction?.action??pose.action} role="img" aria-label="Green Jacket Guy, an animated visual room visitor">
      <svg className="world-visitor-sprite" viewBox="0 0 32 32" shapeRendering="crispEdges" aria-hidden="true">
        {runs.map(r=><rect key={r.x+"-"+r.y} x={r.x} y={r.y} width={r.w} height="1" fill={greenJacketPalette[r.c]??"transparent"}/>)}
      </svg>
      <span className="world-visitor-label">Green Jacket</span>
      {(pose.action==="wave"||reaction?.action==="wave"||reaction?.action==="celebrate")&&<span className="world-visitor-wave" aria-hidden="true">✦</span>}
    </div>
  </>;
}

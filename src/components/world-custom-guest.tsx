import { useEffect,useMemo,useRef,useState,type CSSProperties } from "react";
import type { WorldCustomCharacter } from "@/lib/world-custom-packs";
import { guestIds,guestPose } from "@/lib/world-guest-packs";
import { useCalmInterval,lowPower } from "@/lib/power";
import { useReducedMotion } from "@/lib/reduced-motion";
import { advanceMotionClock } from "@/lib/pal-motion";
import type { CharacterMode } from "@/lib/hellraiser";
import { worldReactionFrame } from "@/lib/world-animation";
import { worldCueReaction, type WorldRoomCue } from "@/lib/world-character-packs";
import { spriteRuns } from "@/lib/sprite-upscale";

/** A data-only user-created visitor. An image cannot become an AI agent via this path. */
export function WorldCustomGuest({character,index,theme,active,cue}:{character:WorldCustomCharacter;index:number;theme:CharacterMode;active:boolean;cue?:WorldRoomCue}){
 const [elapsed,setElapsed]=useState(0),[wave,setWave]=useState(false);
 const prev=useRef(0),reduced=useReducedMotion(),low=lowPower.use();
 const animate=active&&!reduced&&!low;
 const reacting=!!cue&&!reduced&&!low;
 useEffect(()=>{prev.current=performance.now();},[animate,reacting]);
 useCalmInterval(()=>{const now=performance.now(),delta=now-prev.current;prev.current=now;setElapsed(e=>advanceMotionClock(e,delta));},125,animate||reacting);
 useEffect(()=>{if(!wave)return;const t=window.setTimeout(()=>setWave(false),1700);return()=>window.clearTimeout(t);},[wave]);
 const routeId=guestIds[index%guestIds.length]!;
 const pose=guestPose(routeId,theme,animate?elapsed+index*2200:0);
 const reaction=worldCueReaction(cue,character.id,Date.now(),reduced||low);
 const fallbackAction=wave?"wave":pose.action;
 const action=reaction?.action??fallbackAction;
 const frame=reaction?.frame??Math.floor(elapsed/175)%4;
 const runs=useMemo(()=>spriteRuns(worldReactionFrame(character.pixels,pose.facing,reaction,fallbackAction,Math.floor(elapsed/175)%4),(x,y)=>y<24?"body":x<16?"left-leg":"right-leg"),[character.pixels,pose.facing,action,frame]);
 const style={"--world-guest-x":pose.x+"%","--world-guest-y":pose.y+"%"} as CSSProperties;
 return <button type="button" className="world-guest world-custom-guest" aria-label={"Wave to "+character.name} style={style} data-action={action} onClick={()=>setWave(true)}>
  <svg viewBox="0 0 32 32" className="world-guest-pixels" role="img" shapeRendering="crispEdges" aria-label={character.name+" custom pixel character"}>
   {runs.map(r=><rect key={r.x+"-"+r.y} x={r.x} y={r.y} width={r.w} height="1" fill={character.palette[r.c]??"transparent"}/>)}
  </svg>
  <span className="world-guest-name">{character.name}</span>
  {(wave||action==="wave"||action==="celebrate")&&<span className="world-guest-spark" aria-hidden="true">✦</span>}
 </button>;
}

import { useEffect,useMemo,useRef,useState,type CSSProperties } from "react";
import type { WorldCustomCharacter } from "@/lib/world-custom-packs";
import { guestIds,guestPose } from "@/lib/world-guest-packs";
import { useCalmInterval,lowPower } from "@/lib/power";
import { useReducedMotion } from "@/lib/reduced-motion";
import { advanceMotionClock } from "@/lib/pal-motion";
import type { CharacterMode } from "@/lib/hellraiser";
import { worldAnimatedFrame } from "@/lib/world-animation";
import { spriteRuns } from "@/lib/sprite-upscale";

/** A data-only user-created visitor. An image cannot become an AI agent via this path. */
export function WorldCustomGuest({character,index,theme,active}:{character:WorldCustomCharacter;index:number;theme:CharacterMode;active:boolean}){
 const [elapsed,setElapsed]=useState(0),[wave,setWave]=useState(false);
 const prev=useRef(0),reduced=useReducedMotion(),low=lowPower.use();
 const animate=active&&!reduced&&!low;
 useEffect(()=>{prev.current=performance.now();},[animate]);
 useCalmInterval(()=>{const now=performance.now(),delta=now-prev.current;prev.current=now;setElapsed(e=>advanceMotionClock(e,delta));},125,animate);
 useEffect(()=>{if(!wave)return;const t=window.setTimeout(()=>setWave(false),1700);return()=>window.clearTimeout(t);},[wave]);
 const routeId=guestIds[index%guestIds.length]!;
 const pose=guestPose(routeId,theme,animate?elapsed+index*2200:0);
 const action=wave?"wave":pose.action;
 const frame=Math.floor(elapsed/175)%4;
 const runs=useMemo(()=>spriteRuns(worldAnimatedFrame(character.pixels,pose.facing,action,frame),(x,y)=>y<24?"body":x<16?"left-leg":"right-leg"),[character.pixels,pose.facing,action,frame]);
 const style={"--world-guest-x":pose.x+"%","--world-guest-y":pose.y+"%"} as CSSProperties;
 return <button type="button" className="world-guest world-custom-guest" aria-label={"Wave to "+character.name} style={style} data-action={action} onClick={()=>setWave(true)}>
  <svg viewBox="0 0 32 32" className="world-guest-pixels" role="img" shapeRendering="crispEdges" aria-label={character.name+" custom pixel character"}>
   {runs.map(r=><rect key={r.x+"-"+r.y} x={r.x} y={r.y} width={r.w} height="1" fill={character.palette[r.c]??"transparent"}/>)}
  </svg>
  <span className="world-guest-name">{character.name}</span>
  {wave&&<span className="world-guest-spark" aria-hidden="true">✦</span>}
 </button>;
}

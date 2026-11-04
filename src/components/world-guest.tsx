import { useEffect,useMemo,useRef,useState,type CSSProperties } from "react";
import type { CharacterMode } from "@/lib/hellraiser";
import { lowPower,useCalmInterval } from "@/lib/power";
import { useReducedMotion } from "@/lib/reduced-motion";
import { advanceMotionClock } from "@/lib/pal-motion";
import { worldReactionFrame } from "@/lib/world-animation";
import { worldCueReaction, type WorldRoomCue } from "@/lib/world-character-packs";
import { spriteRuns } from "@/lib/sprite-upscale";
import { guestName,guestPalette,guestPose,guestSprite,type GuestId } from "@/lib/world-guest-packs";

const artById=new Map<GuestId,string[]>();
function getArt(id:GuestId){let found=artById.get(id);if(!found){found=guestSprite(id);artById.set(id,found);}return found;}
/** A display-only character; click to wave, never sends a chat or tool request. */
export function WorldGuest({id,theme,active,cue}:{id:GuestId;theme:CharacterMode;active:boolean;cue?:WorldRoomCue}){
 const [elapsed,setElapsed]=useState(0),[greet,setGreet]=useState(false);
 const prev=useRef(0),reduced=useReducedMotion(),low=lowPower.use();
 const animate=active&&!reduced&&!low;
 const reacting=!!cue&&!reduced&&!low;
 useEffect(()=>{prev.current=performance.now();},[animate,reacting]);
 useCalmInterval(()=>{const now=performance.now(),delta=now-prev.current;prev.current=now;setElapsed(t=>advanceMotionClock(t,delta));},120,animate||reacting);
 useEffect(()=>{if(!greet)return;const timeout=window.setTimeout(()=>setGreet(false),2000);return()=>window.clearTimeout(timeout);},[greet]);
 const pose=guestPose(id,theme,animate?elapsed:0);
 const reaction=worldCueReaction(cue,id,Date.now(),reduced||low);
 const fallbackAction=greet?"wave":pose.action;
 const action=reaction?.action??fallbackAction,frame=reaction?.frame??Math.floor(elapsed/180)%4;
 const runs=useMemo(()=>spriteRuns(worldReactionFrame(getArt(id),pose.facing,reaction,fallbackAction,Math.floor(elapsed/180)%4),(x,y)=>y<24?"body":x<16?"left-leg":"right-leg"),[id,pose.facing,action,frame]);
 const style={"--world-guest-x":pose.x+"%","--world-guest-y":pose.y+"%"} as CSSProperties;
 return <button type="button" style={style} className="world-guest" data-action={action} aria-label={"Wave to "+guestName(id)} title={"Wave to "+guestName(id)+" · visual only"} onClick={()=>setGreet(true)}>
   <svg viewBox="0 0 32 32" className="world-guest-pixels" shapeRendering="crispEdges" role="img" aria-label={guestName(id)+" animated pixel character"}>{runs.map(r=><rect key={r.x+"-"+r.y} x={r.x} y={r.y} width={r.w} height="1" fill={guestPalette[r.c]??"transparent"}/>)}</svg>
   <span className="world-guest-name">{guestName(id)}</span>
   {action==="wave"&&<span className="world-guest-spark" aria-hidden="true">✦</span>}
 </button>;
}

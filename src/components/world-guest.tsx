import { useEffect,useMemo,useRef,useState,type CSSProperties } from "react";
import type { CharacterMode } from "@/lib/hellraiser";
import { lowPower,useCalmInterval,useTabHidden } from "@/lib/power";
import { useReducedMotion } from "@/lib/reduced-motion";
import { advanceMotionClock, type PalMotion } from "@/lib/pal-motion";
import { worldReactionFrame } from "@/lib/world-animation";
import { worldCueReaction, type WorldRoomCue } from "@/lib/world-character-packs";
import { spriteRuns } from "@/lib/sprite-upscale";
import { guestIds,guestName,guestPalette,guestSprite,guestWanderPose,type GuestId } from "@/lib/world-guest-packs";
import { worldDepthScale,worldDepthZ } from "@/lib/world-floor";
import { WORLD_LEG_EXTENSION,worldGuestBody,worldLegRow,worldTallSprite } from "@/lib/world-proportions";
import { worldStepFrame,type WorldGait,type WorldWanderAction } from "@/lib/world-wander";
import { useWorldActor,useWorldFixtureUse,worldGreeting,worldPresenceSnapshot } from "@/lib/world-presence";

const artById=new Map<GuestId,string[]>();
function getArt(id:GuestId){let found=artById.get(id);if(!found){found=guestSprite(id);artById.set(id,found);}return found;}
/** How each built-in guest moves (decorative: speed, bob and shadow only). */
export const guestGait=(id:GuestId):WorldGait=>id==="arcade-ghost"?"floating":id==="tiny-dragon"?"flying":"humanoid";
/** Map a wander action onto the existing four-frame 32px gesture atlas. */
export function worldMotionFor(action:WorldWanderAction|"talk"):PalMotion{
 switch(action){
  case "walk":return "walk";
  case "turn":case "look":return "look";
  case "interaction":return "work";
  case "rest":return "rest";
  case "wave":return "wave";
  case "celebrate":return "celebrate";
  case "talk":return "talk";
  default:return "idle";
 }
}
/** A display-only character; click to wave, never sends a chat or tool request. */
export function WorldGuest({id,theme,active,cue,paused=false}:{id:GuestId;theme:CharacterMode;active:boolean;cue?:WorldRoomCue;paused?:boolean}){
 const [elapsed,setElapsed]=useState(0),[greet,setGreet]=useState(false);
 const prev=useRef(0),reduced=useReducedMotion(),low=lowPower.use(),hidden=useTabHidden();
 const animate=active&&!paused&&!reduced&&!low&&!hidden;
 const reacting=!!cue&&!paused&&!reduced&&!low&&!hidden;
 useEffect(()=>{prev.current=performance.now();},[animate,reacting]);
 useCalmInterval(()=>{const now=performance.now(),delta=now-prev.current;prev.current=now;setElapsed(t=>advanceMotionClock(t,delta));},100,animate||reacting);
 useEffect(()=>{if(!greet)return;const timeout=window.setTimeout(()=>setGreet(false),2000);return()=>window.clearTimeout(timeout);},[greet]);
 const gait=guestGait(id),actor="guest:"+id;
 // Paused guests keep their last position (the clock simply stops) instead of snapping back to the start.
 const pose=guestWanderPose(id,guestIds.indexOf(id),theme,elapsed,gait);
 const standing=pose.dwelling&&(pose.action==="idle"||pose.action==="look");
 const {rootRef,labelRef,labelHidden}=useWorldActor(actor,pose.x,pose.y,animate&&standing,true,elapsed);
 const greeting=animate&&standing?worldGreeting({id:actor,x:pose.x,y:pose.y,dwelling:true,at:Date.now()},worldPresenceSnapshot(),Date.now()):null;
 useWorldFixtureUse(actor,theme,animate&&pose.action==="interaction"?pose.fixture:null);
 const reaction=worldCueReaction(cue,id,Date.now(),paused||reduced||low||hidden);
 const fallbackAction:PalMotion=greet?"wave":greeting?"talk":worldMotionFor(pose.action);
 const facing=greeting&&!greet?greeting.facing:pose.facing;
 const action=reaction?.action??fallbackAction;
 const step=fallbackAction==="walk"?worldStepFrame(pose,gait):Math.floor(elapsed/180)%4;
 const frame=reaction?.frame??step;
 // Adult proportions for the room: legs lengthened by body type, pixels stay square (see world-proportions).
 const grid=useMemo(()=>worldTallSprite(worldReactionFrame(getArt(id),facing,reaction,fallbackAction,step),WORLD_LEG_EXTENSION[worldGuestBody(id)],worldLegRow("guest:"+id,()=>getArt(id))),[id,facing,action,frame]); // eslint-disable-line react-hooks/exhaustive-deps
 const runs=useMemo(()=>spriteRuns(grid,(x,y)=>y<24?"body":x<16?"left-leg":"right-leg"),[grid]);
 const style={"--world-guest-x":pose.x+"%","--world-guest-y":pose.y+"%","--world-z":String(worldDepthZ(pose.y)),"--world-depth-scale":String(worldDepthScale(pose.y))} as CSSProperties;
 return <button type="button" ref={el=>{rootRef.current=el;}} style={style} className="world-guest" data-action={action} data-facing={facing} data-movement={gait} data-paused={!animate} aria-label={"Wave to "+guestName(id)} title={"Wave to "+guestName(id)+" · visual only"} onClick={()=>setGreet(true)}>
   <svg viewBox={"0 0 32 "+grid.length} preserveAspectRatio="xMidYMax meet" className="world-guest-pixels" shapeRendering="crispEdges" role="img" aria-label={guestName(id)+" animated pixel character"}>{runs.map(r=><rect key={r.x+"-"+r.y} x={r.x} y={r.y} width={r.w} height="1" fill={guestPalette[r.c]??"transparent"}/>)}</svg>
   <span ref={el=>{labelRef.current=el;}} className={"world-guest-name"+(labelHidden?" world-label-hidden":"")}>{guestName(id)}</span>
   {(action==="wave"||action==="celebrate")&&<span className="world-guest-spark" aria-hidden="true">✦</span>}
   {action==="talk"&&<span className="world-guest-chat" aria-hidden="true">…</span>}
 </button>;
}

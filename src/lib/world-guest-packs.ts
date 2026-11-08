import { easeWalk } from "./pal-motion";
import type { Facing } from "./pal-art";
import type { CharacterMode } from "./hellraiser";
import { worldCharacterPacks, type WorldPackId } from "./world-character-packs";
import { worldPath, worldRoomPlan, type WorldPoint } from "./world-floor";
import { worldWanderPlan, worldWanderPose, type WorldGait, type WorldWanderPose } from "./world-wander";

export type GuestId = Exclude<WorldPackId, "green-jacket">;
export const guestIds: readonly GuestId[] = ["goku","homer","moon-mage","arcade-ghost","space-ranger","pixel-robot","tiny-dragon","dungeon-knight"];
const box=(g:string[][],x:number,y:number,w:number,h:number,c:string)=>{for(let j=y;j<y+h;j++)for(let i=x;i<x+w;i++)if(g[j]&&i>=0&&i<32)g[j]![i]=c;};
const dot=(g:string[][],x:number,y:number,c:string)=>box(g,x,y,1,1,c);
const allPalettes: Record<string,string> = {".":"transparent",i:"#171925",w:"#f5f4e8",s:"#e6a482",d:"#4d5365",h:"#251f34",b:"#365cba",o:"#e87e20",q:"#f5ca55",y:"#f6da4d",p:"#e86cb0",c:"#4fc9ea",v:"#9b6ae8",g:"#8ad36c",k:"#647e8e",r:"#d84b4b",a:"#aef2ff",n:"#31465b"};
export const guestPalette=allPalettes;
export function guestName(id:GuestId):string {
 return worldCharacterPacks.find(p=>p.id===id)?.name??id;
}
/** Eight distinct original silhouettes, not fetched external media. */
export function guestSprite(id:GuestId):string[]{
 const g=Array.from({length:32},()=>Array<string>(32).fill("."));
 const B=(x:number,y:number,w:number,h:number,c:string)=>box(g,x,y,w,h,c);
 const D=(x:number,y:number,c:string)=>dot(g,x,y,c);
 const shoes=(c="d")=>{B(11,26,5,4,c);B(18,26,5,4,c);B(10,29,6,2,"i");B(18,29,6,2,"i");};
 if(id==="goku"){
  shoes("b");B(10,16,14,12,"o");B(7,18,4,8,"o");B(23,18,4,8,"o");
  B(12,17,10,3,"b");B(11,24,13,2,"b");B(8,24,3,3,"s");B(24,24,3,3,"s");
  B(11,7,13,10,"s");B(10,6,15,4,"i");B(10,3,4,6,"h");B(14,1,4,8,"h");B(18,4,4,6,"h");B(22,2,3,8,"h");
  B(12,3,8,3,"h");B(13,10,2,1,"i");B(20,10,2,1,"i");B(16,13,4,1,"r");
  B(18,19,3,3,"q");D(19,20,"i");
 }else if(id==="homer"){
  shoes("b");B(10,24,15,5,"b");B(9,16,17,9,"w");B(7,18,4,8,"y");B(24,18,4,8,"y");
  B(10,6,15,12,"y");B(11,4,12,3,"y");B(12,3,8,2,"y");
  D(15,3,"h");D(16,2,"h");D(18,3,"h");B(21,4,2,3,"h");
  B(12,9,4,3,"w");B(18,9,4,3,"w");D(14,10,"i");D(20,10,"i");
  B(16,12,6,2,"s");B(13,15,11,2,"s");B(16,16,5,1,"i");
  B(12,17,5,2,"w");B(21,18,3,2,"w");
 }else if(id==="moon-mage"){
  shoes("v");B(8,16,18,12,"v");B(11,14,13,12,"b");B(6,19,4,9,"v");B(25,19,3,9,"v");
  B(10,7,14,10,"h");B(11,9,12,7,"s");B(9,3,16,5,"v");B(13,1,8,3,"v");
  D(14,11,"a");D(20,11,"a");B(26,10,2,19,"d");B(25,9,4,3,"q");D(27,7,"a");D(25,5,"q");
 }else if(id==="arcade-ghost"){
  B(8,6,17,20,"c");B(10,4,13,2,"c");B(7,10,19,12,"c");
  B(7,22,5,5,"c");B(14,22,6,4,"c");B(22,22,5,5,"c");
  B(10,12,5,5,"w");B(18,12,5,5,"w");B(12,14,3,3,"b");B(20,14,3,3,"b");
  B(13,19,9,2,"v");D(16,18,"p");
 }else if(id==="space-ranger"){
  shoes("d");B(8,16,18,11,"w");B(7,18,4,9,"w");B(24,18,4,9,"w");B(12,17,10,6,"k");
  B(10,4,16,13,"w");B(12,7,12,7,"n");B(13,8,10,5,"a");B(14,11,8,2,"b");
  B(14,20,6,3,"o");D(16,21,"q");B(6,23,3,3,"r");B(25,23,3,3,"r");
 }else if(id==="pixel-robot"){
  shoes("k");B(9,15,16,13,"d");B(7,18,3,8,"k");B(24,18,3,8,"k");B(12,19,10,6,"k");
  B(11,5,14,11,"i");B(12,6,12,9,"k");B(14,9,3,3,"c");B(20,9,3,3,"c");
  B(15,13,7,1,"y");B(17,2,2,3,"d");D(18,1,"r");B(11,17,3,2,"c");
 }else if(id==="tiny-dragon"){
  shoes("g");B(10,15,15,13,"g");B(6,17,7,9,"v");B(22,18,7,8,"v");
  B(10,6,15,12,"g");B(12,4,4,4,"g");B(19,3,4,5,"g");
  B(14,10,3,3,"w");B(20,10,3,3,"w");D(16,11,"i");D(21,11,"i");
  B(18,15,6,2,"y");B(13,20,9,4,"q");B(25,23,5,3,"g");D(30,22,"g");
 }else if(id==="dungeon-knight"){
  shoes("d");B(9,15,17,13,"k");B(7,18,4,8,"k");B(24,18,4,8,"k");
  B(11,5,14,12,"d");B(12,6,12,10,"k");B(14,9,9,3,"i");B(15,10,7,1,"a");
  B(16,2,4,4,"r");B(17,1,2,3,"r");B(5,18,6,11,"n");B(6,19,4,8,"y");
  B(25,8,2,20,"d");D(26,7,"w");
 }
 return g.map(row=>row.join(""));
}
const cached=new Map<string,readonly WorldPoint[]>();
/** Legacy single-route loop (kept for compatibility); calibrated per theme from that room's own floor plan. */
export function guestRoute(id:GuestId,theme:CharacterMode):readonly WorldPoint[]{
 const key=theme+":"+id,found=cached.get(key);if(found)return found;
 const plan=worldRoomPlan(theme),slot=Math.max(0,guestIds.indexOf(id));
 const route=worldPath(plan.visits[slot]!,plan.homes[slot]!,theme);
 cached.set(key,route);return route;
}
/** Where each visitor starts its itinerary: spread over visit spots so guests don't spawn on top of Pals. */
/**
 * Where a guest starts. Built-in guests (slots 0–7) take visit spots in order; imported visitors (slot 8+)
 * use the room's `entries` when it has them, otherwise the odd visit spots first, then the even ones, so they spread across the room instead of starting
 * on a Pal's home spot (which made crowds pile up, worst in the horror mansion's separate pockets).
 */
export function guestStart(slot:number,theme:CharacterMode):WorldPoint{
 const plan=worldRoomPlan(theme),n=Math.floor(Number.isFinite(slot)?slot:0);
 if(n>=8&&plan.entries?.length)return plan.entries[(n-8)%plan.entries.length]!;
 const spots=plan.visits.length?plan.visits:plan.homes;
 if(!spots.length)return {x:50,y:76};
 const index=n<8?n:2*(n-8)+1;
 return spots[((index%spots.length)+spots.length)%spots.length]!;
}
/**
 * Natural multi-stop wandering for a visual guest: steady gait, turns, look-arounds and furniture use.
 * `seed` keeps each character's itinerary unique; `slot` picks its starting spot.
 */
export function guestWanderPose(seed:string,slot:number,theme:CharacterMode,elapsed:number,gait:WorldGait="humanoid"):WorldWanderPose{
 const plan=worldWanderPlan({theme,seed:"guest:"+seed,start:guestStart(slot,theme),gait,legs:7});
 return worldWanderPose(plan,elapsed);
}
function follow(path:readonly WorldPoint[],fraction:number,reverse:boolean){
 const points=reverse?[...path].reverse():path;
 if(!points.length)return {x:50,y:76,facing:"s" as Facing};
 if(points.length===1)return {...points[0]!,facing:"s" as Facing};
 const distances=points.slice(1).map((p,i)=>Math.hypot(p.x-points[i]!.x,p.y-points[i]!.y));
 let target=distances.reduce((a,b)=>a+b,0)*easeWalk(fraction);
 for(let i=0;i<distances.length;i++){
  const a=points[i]!,b=points[i+1]!,length=distances[i]!;
  if(target<=length||i===distances.length-1){
   const t=length?Math.max(0,Math.min(1,target/length)):0;
   const x=a.x+(b.x-a.x)*t,y=a.y+(b.y-a.y)*t;
   const degrees=Math.atan2(b.y-a.y,b.x-a.x)*180/Math.PI;
   const headings:Facing[]=["e","se","s","sw","w","nw","n","ne"];
   return {x,y,facing:headings[((Math.round(degrees/45)%8)+8)%8]??"s"};
  }
  target-=length;
 }
 return {...points[points.length-1]!,facing:"s" as Facing};
}
export type GuestPose={x:number;y:number;facing:Facing;action:"idle"|"walk"|"wave"|"celebrate";walking:boolean};
export function guestPose(id:GuestId,theme:CharacterMode,elapsed:number):GuestPose{
 const path=guestRoute(id,theme);
 const index=guestIds.indexOf(id);
 const t=(Math.max(0,Number.isFinite(elapsed)?elapsed:0)+index*2500)%39000;
 const out=t>=5000&&t<17000,back=t>=22000&&t<34000;
 const moving=out||back;
 const pose=out?follow(path,(t-5000)/12000,false):back?follow(path,(t-22000)/12000,true):follow(path,t>=17000&&t<22000?1:0,false);
 return {...pose,action:moving?"walk":t>=17000&&t<22000?"wave":t>=34000?"celebrate":"idle",walking:moving&&path.length>1};
}

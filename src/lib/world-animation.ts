import type { Facing } from "./pal-art";
import type { PalMotion } from "./pal-motion";
import { worldFacingSprite } from "./world-facing-sprites";

export const WORLD_ACTIONS = ["idle","look","wave","stretch","talk","work","rest","celebrate","walk"] as const satisfies readonly PalMotion[];
export const WORLD_DIRECTIONS = ["n","ne","e","se","s","sw","w","nw"] as const satisfies readonly Facing[];
export const WORLD_FRAMES_PER_ACTION = 4;

/**
 * Authored 32px gesture masks applied over each Pal's unique theme sprite and
 * direction. This is a complete four-frame *procedural* atlas for all actions
 * and headings, not a claim of separately illustrated PNG sprite sheets.
 */
export function worldAnimatedFrame(front:readonly string[],facing:Facing,action:PalMotion,frame:number,chest=false):string[]{
 if(front.length!==32||front.some(row=>row.length!==32))return [...front];
 const phase=Number.isFinite(frame)?((Math.trunc(frame)%4)+4)%4:0;
 const g=worldFacingSprite([...front],facing,action==="walk"?phase:0,chest).map(row=>row.split(""));
 const get=(x:number,y:number)=>g[y]?.[x]??".";
 const put=(x:number,y:number,v:string)=>{if(x>=0&&x<32&&y>=0&&y<32)g[y]![x]=v;};
 const ink=get(10,17)!=="."?get(10,17):"i";
 const skin=get(9,23)!=="."?get(9,23):ink;
 const highlight=get(16,17)!=="."?get(16,17):ink;
 const shift=(y1:number,y2:number,x1:number,x2:number,dx:number,dy:number)=>{
  const before=g.map(row=>row.slice());
  for(let y=y1;y<=y2;y++)for(let x=x1;x<=x2;x++)if(before[y]?.[x]!==".")put(x,y,".");
  for(let y=y1;y<=y2;y++)for(let x=x1;x<=x2;x++){
   const v=before[y]?.[x];if(v&&v!==".")put(x+dx,y+dy,v);
  }
 };
 if(action==="walk"){
  // Real footstep frames are already produced by the direction engine.
  // Animate opposite shoulders to make turns and diagonals readable.
  if(!chest&&phase%2===1) {
   const left=phase===1?-1:1;
   shift(16,22,7,10,0,left);
   shift(16,22,23,26,0,-left);
  }
 }else if(action==="look"){
  if(!chest&&phase===1){shift(5,13,10,23,1,0);}
  if(!chest&&phase===3){shift(5,13,10,23,-1,0);}
 }else if(action==="wave"){
  const right=phase===1||phase===3;
  // Lift the right arm and vary hand pixels in all four frames.
  for(let y=15;y<23;y++)for(let x=24;x<28;x++)if(get(x,y)!==".")put(x,y,".");
  for(let y=13;y<19;y++)put(25,y,ink);
  put(25+(right?2:0),13,skin);put(25+(right?2:0),12,skin);
  put(26+(right?2:0),14,skin);
 }else if(action==="stretch"){
  if(phase===1||phase===2) {
   for(let x=7;x<=10;x++)put(x,13,ink);
   for(let x=23;x<=26;x++)put(x,13,ink);
   put(8,11,skin);put(24,11,skin);
   shift(16,24,12,21,0,-1);
  }
 }else if(action==="work"){
  // Glowing accessory changes through a simple four-phase operation.
  put(26,19,ink);put(27,19,ink);put(27,20,highlight);
  if(phase!==0)put(26,17+phase%2,highlight);
 }else if(action==="talk"){
  if(!chest) {
   const mouth=phase%2?ink:highlight;
   for(let x=15;x<=18;x++)put(x,13,mouth);
  } else if(phase%2) {
   put(16,23,highlight);
  }
 }else if(action==="rest"){
  if(!chest) {
   for(const x of [13,19]){put(x,9,ink);put(x+1,9,ink);}
  }
 }else if(action==="celebrate"){
  for(let y=11;y<17;y++){put(7,y,ink);put(26,y,ink);}
  put(7,10,skin);put(26,10,skin);
  if(phase%2===0){put(4,6,highlight);put(28,6,highlight);}
  if(phase%2===1){put(3,9,highlight);put(29,9,highlight);}
 }else if(action==="idle"&&phase===3&&!chest){
  // A blink: two thin lines rather than permanently closed eyes.
  for(const x of [13,19]){put(x,9,ink);put(x+1,9,ink);}
 }
 return g.map(row=>row.join(""));
}
/** Lazy, testable 8-heading x 9-action x 4-frame atlas for one Pal+theme. */
export function worldSpriteAtlas(front:readonly string[],chest=false):Record<string,string[]>{
 const atlas:Record<string,string[]>={};
 for(const dir of WORLD_DIRECTIONS)for(const action of WORLD_ACTIONS)for(let frame=0;frame<WORLD_FRAMES_PER_ACTION;frame++)
  atlas[dir+":"+action+":"+frame]=worldAnimatedFrame(front,dir,action,frame,chest);
 return atlas;
}

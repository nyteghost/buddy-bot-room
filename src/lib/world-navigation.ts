import type { AgentId } from "./agents";
import type { CharacterMode } from "./hellraiser";
import { headingOf, officePose, officeStations, type Heading } from "./office-motion";
import { easeWalk } from "./pal-motion";

export type WorldPoint = Readonly<{x:number;y:number}>;
export type WorldObstacle = Readonly<{x1:number;y1:number;x2:number;y2:number;label:string}>;
type RoomPlan = Readonly<{bounds:Readonly<{x1:number;y1:number;x2:number;y2:number}>;obstacles:readonly WorldObstacle[];homes:readonly WorldPoint[];visits:readonly WorldPoint[]}>;
const point=(x:number,y:number):WorldPoint=>({x,y});
/** The feet are the collision anchor: floor only, with furniture treated as solid. */
const bounds={x1:9,y1:35,x2:91,y2:85};
const commonHomes=[point(21,43),point(35,43),point(64,43),point(79,43),point(20,76),point(35,77),point(65,77),point(80,76),point(51,77)];
const commonVisits=[point(31,66),point(39,70),point(66,68),point(74,68),point(24,61),point(36,60),point(63,60),point(77,61),point(51,43)];
const rect=(x1:number,y1:number,x2:number,y2:number,label:string):WorldObstacle=>({x1,y1,x2,y2,label});
const table=rect(42,50,59,64,"central furniture");
const themedObstacles:Record<CharacterMode,readonly WorldObstacle[]>={
 normal:[table,rect(10,36,17,40,"left shelf"),rect(82,36,89,40,"right shelf")],
 matrix:[rect(43,49,58,63,"console table"),rect(10,35,17,40,"server rack"),rect(81,35,90,40,"terminal")],
 finalfantasy:[rect(44,50,57,66,"crystal pedestal"),rect(12,53,22,61,"left altar")],
 devteam:[rect(40,49,60,65,"team desk"),rect(11,35,16,40,"equipment")],
 cyberpunk:[rect(41,50,59,64,"neon desk"),rect(79,35,90,40,"console wall")],
 dcc:[rect(44,50,57,65,"loot table"),rect(13,51,23,61,"loot chest")],
 linux:[rect(41,49,59,63,"conference desk")],
 assistant:[rect(41,49,59,63,"conference desk")],
 hellraiser:[rect(43,50,59,66,"puzzle dais"),rect(14,52,23,62,"chain column")],
 horror:[rect(40,51,60,65,"parlor table"),rect(78,45,88,51,"television")],
};
const aIds:AgentId[]=["nova","byte","sage","pip","echo","rune","claude","saiyan","mimic"];
const step=3;
const width=Math.floor((bounds.x2-bounds.x1)/step)+1;
const height=Math.floor((bounds.y2-bounds.y1)/step)+1;
const pointOf=(col:number,row:number)=>point(bounds.x1+col*step,bounds.y1+row*step);
const cellOf=(p:WorldPoint)=>({col:Math.max(0,Math.min(width-1,Math.round((p.x-bounds.x1)/step))),row:Math.max(0,Math.min(height-1,Math.round((p.y-bounds.y1)/step)))});
const idOf=(c:number,r:number)=>r*width+c;
const isBlocked=(p:WorldPoint,theme:CharacterMode):boolean=>{
 if(p.x<bounds.x1||p.y<bounds.y1||p.x>bounds.x2||p.y>bounds.y2)return true;
 return themedObstacles[theme].some(o=>p.x>=o.x1-1&&p.x<=o.x2+1&&p.y>=o.y1-1&&p.y<=o.y2+1);
};
export function worldRoomPlan(theme:CharacterMode):RoomPlan{
 return {bounds,obstacles:themedObstacles[theme],homes:commonHomes,visits:commonVisits};
}
export function worldPointIsWalkable(point:WorldPoint,theme:CharacterMode):boolean{return !isBlocked(point,theme);}
function nearestFree(p:WorldPoint,theme:CharacterMode):number{
 const base=cellOf(p);let best=-1,bestDistance=Infinity;
 for(let r=0;r<height;r++)for(let c=0;c<width;c++){
  if(isBlocked(pointOf(c,r),theme))continue;
  const distance=Math.abs(c-base.col)+Math.abs(r-base.row);
  if(distance<bestDistance){bestDistance=distance;best=idOf(c,r);}
 }
 return best;
}
/** A* eight-direction foot path; diagonal moves cannot cut through corners. */
export function worldPath(from:WorldPoint,to:WorldPoint,theme:CharacterMode):WorldPoint[]{
 const start=nearestFree(from,theme),end=nearestFree(to,theme);
 if(start<0||end<0)return [];
 if(start===end)return [pointOf(start%width,Math.floor(start/width))];
 const size=width*height, open=new Set<number>([start]),prev=new Int32Array(size).fill(-1),g=new Float64Array(size).fill(Infinity),f=new Float64Array(size).fill(Infinity);
 g[start]=0; const dist=(id:number)=>Math.hypot(id%width-end%width,Math.floor(id/width)-Math.floor(end/width));
 f[start]=dist(start);
 const steps=[[-1,-1],[0,-1],[1,-1],[-1,0],[1,0],[-1,1],[0,1],[1,1]];
 for(let iter=0;iter<size*5&&open.size;iter++){
  let curr=-1,min=Infinity;
  for(const n of open)if(f[n]<min){curr=n;min=f[n]!;}
  if(curr<0)break;
  if(curr===end){
   const found:number[]=[];let last=curr;
   while(last!==-1){found.unshift(last);last=prev[last]!;}
   return found.map(n=>pointOf(n%width,Math.floor(n/width)));
  }
  open.delete(curr);const c=curr%width,r=Math.floor(curr/width);
  for(const [dc,dr] of steps){
   const nc=c+dc!,nr=r+dr!;
   if(nc<0||nr<0||nc>=width||nr>=height||isBlocked(pointOf(nc,nr),theme))continue;
   if(dc&&dr&&(isBlocked(pointOf(nc,r),theme)||isBlocked(pointOf(c,nr),theme)))continue;
   const n=idOf(nc,nr),cost=g[curr]!+Math.hypot(dc!,dr!);
   if(cost<g[n]!){prev[n]=curr;g[n]=cost;f[n]=cost+dist(n);open.add(n);}
  }
 }
 return [];
}
const routeCache=new Map<string,readonly WorldPoint[]>();
export function worldRoute(id:AgentId,theme:CharacterMode):readonly WorldPoint[]{
 const key=theme+":"+id,existing=routeCache.get(key);
 if(existing)return existing;
 const index=aIds.indexOf(id),plan=worldRoomPlan(theme);
 const path=worldPath(plan.homes[index]!,plan.visits[index]!,theme);
 routeCache.set(key,path);
 return path;
}
function along(path:readonly WorldPoint[],ratio:number){
 if(!path.length)return {x:50,y:70,heading:"s" as Heading};
 if(path.length===1)return {...path[0]!,heading:"s" as Heading};
 const lengths=path.slice(1).map((p,i)=>Math.hypot(p.x-path[i]!.x,p.y-path[i]!.y));
 const sum=lengths.reduce((a,b)=>a+b,0),target=easeWalk(Math.max(0,Math.min(1,ratio)))*sum;
 let distance=target;
 for(let i=0;i<lengths.length;i++){
  const len=lengths[i]!;
  if(distance<=len||i===lengths.length-1){
   const a=path[i]!,b=path[i+1]!,t=len?Math.max(0,Math.min(1,distance/len)):0;
   return {x:a.x+(b.x-a.x)*t,y:a.y+(b.y-a.y)*t,heading:headingOf(b.x-a.x,b.y-a.y)};
  }
  distance-=len;
 }
 return {...path[path.length-1]!,heading:"s" as Heading};
}
export type WorldPose = {x:number;y:number;heading:Heading;walking:boolean;facingLeft:boolean;action:"idle"|"walk"|"wave"|"work"|"rest"};
/** Different phases across characters. No random teleports or frame-dependent routing. */
export function worldPose(id:AgentId,index:number,elapsed:number,theme:CharacterMode):WorldPose{
 if(theme==="linux"||theme==="assistant"||theme==="devteam"){
  const office=officePose(id,index,elapsed);return {...office,action:office.walking?"walk":"idle"};
 }
 const route=worldRoute(id,theme),time=((Number.isFinite(elapsed)?elapsed:0)+index*2550)%32000;
 const cycle=(time+32000)%32000;
 const moving=cycle>=5500&&cycle<16000||cycle>=20000&&cycle<30500;
 const returning=cycle>=20000&&cycle<30500;
 const ratio=cycle>=5500&&cycle<16000?(cycle-5500)/10500:returning?1-(cycle-20000)/10500:cycle>=16000&&cycle<20000?1:0;
 const pos=along(route,ratio);
 const targetIndex=route.length-1;
 const action:WorldPose["action"]=moving?"walk":cycle>=16000&&cycle<20000?"wave":cycle>=30500?"rest":"idle";
 // Reverse facing when retracing the path; first point remains the same.
 const h=returning&&targetIndex>0?along([...route].reverse(),(cycle-20000)/10500).heading:pos.heading;
 return {x:pos.x,y:pos.y,heading:h,walking:moving&&route.length>1,facingLeft:h.includes("w"),action};
}

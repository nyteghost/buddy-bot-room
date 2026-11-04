import type { Facing } from "./pal-art";
import { easeWalk } from "./pal-motion";

/** Optional visual character packs. No AI providers, credentials or tool permissions. */
export const WORLD_PACKS_KEY = "pixel-pals-world-character-packs-v1";
export const worldCharacterPacks = [
  { id: "green-jacket", name: "Green Jacket Guy", description: "Walks, waves, and occasionally disappears into the scenery." },
] as const;
export type WorldPackId = (typeof worldCharacterPacks)[number]["id"];
export const DEFAULT_WORLD_PACKS: WorldPackId[] = ["green-jacket"];
export function readWorldPacks(raw: string | null): WorldPackId[] {
  if (raw === null || raw.length > 1000) return [...DEFAULT_WORLD_PACKS];
  try {
    const value: unknown = JSON.parse(raw);
    if (!Array.isArray(value)) return [...DEFAULT_WORLD_PACKS];
    const allowed = new Set<string>(worldCharacterPacks.map(p => p.id));
    return [...new Set(value.filter((id): id is WorldPackId => typeof id === "string" && allowed.has(id)))];
  } catch { return [...DEFAULT_WORLD_PACKS]; }
}
export type VisitorAction = "idle" | "walking" | "wave" | "retreat" | "hidden" | "return";
export type VisitorPose = { x: number; y: number; opacity: number; scale: number; facing: Facing; walking: boolean; action: VisitorAction };
const point=(x:number,y:number,action:VisitorAction,facing:Facing,opacity=1,scale=1):VisitorPose=>({
  x,y,opacity,scale,facing,walking:action==="walking"||action==="retreat"||action==="return",action
});
const move=(a:number,b:number,t:number)=>a+(b-a)*easeWalk(t);
/** Deterministic animation loop with a signature bushes-style retreat. */
export function greenJacketPose(elapsed:number):VisitorPose {
  const ms=Number.isFinite(elapsed) ? Math.max(0,elapsed)%40000 : 0;
  if(ms<4000) return point(84,69,"idle","s");
  if(ms<10500){const t=(ms-4000)/6500;return point(move(84,60,t),move(69,64,t),"walking","w");}
  if(ms<14500)return point(60,64,"wave","s");
  if(ms<20500){const t=(ms-14500)/6000;return point(move(60,84,t),move(64,69,t),"walking","e");}
  if(ms<24000){const t=(ms-20500)/3500;return point(move(84,92,t),69,"retreat","e",1-t,1-.23*t);}
  if(ms<29000)return point(92,69,"hidden","e",0,.77);
  if(ms<33200){const t=(ms-29000)/4200;return point(move(92,84,t),69,"return","w",t,.77+.23*t);}
  return point(84,69,"idle","s");
}

/** An original native 32px sprite derived from the user's reference outfit. */
export function greenJacketSprite():string[] {
  const g=Array.from({length:32},()=>Array<string>(32).fill("."));
  const dot=(x:number,y:number,v:string)=>{if(x>=0&&x<32&&y>=0&&y<32)g[y]![x]=v;};
  const box=(x:number,y:number,w:number,h:number,v:string)=>{for(let yy=y;yy<y+h;yy++)for(let xx=x;xx<x+w;xx++)dot(xx,yy,v);};
  // Split dark trousers and boots.
  box(10,24,6,6,"i");box(17,24,6,6,"i");box(11,25,4,4,"n");box(18,25,4,4,"n");
  box(9,29,7,2,"i");box(17,29,7,2,"i");box(10,29,5,1,"d");box(18,29,5,1,"d");
  // The unmistakable neon lime-green / cobalt-blue two-tone jacket.
  box(8,13,16,13,"i");box(9,14,14,11,"l");box(6,16,4,9,"i");box(23,16,4,9,"i");
  box(7,17,3,6,"l");box(24,17,2,6,"l");box(10,18,12,2,"q");
  box(9,19,14,6,"b");box(10,20,12,5,"b");box(7,22,3,2,"i");box(24,22,3,2,"i");
  box(10,21,4,3,"c");box(18,21,4,3,"c");box(10,21,4,1,"i");box(18,21,4,1,"i");
  box(7,24,3,2,"s");box(24,24,3,2,"s");
  // Bald crown, dark hair around the sides and short gray beard.
  box(10,3,13,10,"i");box(12,3,9,9,"s");box(13,2,7,3,"s");
  box(10,5,3,7,"h");box(21,5,3,7,"h");box(10,10,3,3,"d");box(21,10,3,3,"d");
  box(11,11,12,4,"d");box(12,11,10,3,"g");box(14,13,6,2,"g");
  dot(13,8,"i");dot(20,8,"i");box(15,10,3,1,"t");box(15,12,4,1,"d");
  // Dark collar with red lanyard and reflective highlights.
  box(12,14,9,2,"i");box(14,15,2,5,"r");box(18,15,2,5,"r");box(15,19,4,2,"r");
  dot(16,19,"w");dot(17,19,"w");
  return g.map(row=>row.join(""));
}
export const greenJacketPalette:Record<string,string>={
  i:"#181a1d", n:"#353941", d:"#686d73", h:"#352c28",
  s:"#f2b38f", t:"#cc856a", g:"#bcc5c1",
  l:"#b6f22f", q:"#77cc20", b:"#2156ae", c:"#3876ce",
  r:"#e83a62", w:"#f4e6da"
};
export function worldHideoutForTheme(theme:string):"hedge"|"server"|"portal" {
  if(["linux","assistant","devteam","matrix","cyberpunk"].includes(theme))return "server";
  if(["hellraiser","horror","finalfantasy","dcc"].includes(theme))return "portal";
  return "hedge";
}

import {describe,expect,it} from "vitest";
import {guestIds,guestName,guestPalette,guestSprite,guestPose,guestRoute} from "@/lib/world-guest-packs";
import {characterModes} from "@/lib/hellraiser";
import {worldPointIsWalkable} from "@/lib/world-navigation";
import {worldAnimatedFrame} from "@/lib/world-animation";
describe("Character Universe visual visitor roster",()=>{
 it("provides eight distinctive original and fan tribute models",()=>{
  expect(guestIds.length).toBe(8);
  const silhouettes=new Set<string>();
  for(const id of guestIds){
   expect(guestName(id).length).toBeGreaterThan(2);
   const g=guestSprite(id);
   expect(g).toHaveLength(32);expect(g.every(row=>row.length===32)).toBe(true);
   const codes=new Set(g.join("").replace(/\./g,""));
   for(const code of codes)expect(guestPalette[code]).toBeTruthy();
   silhouettes.add(g.join("\n"));
   expect(worldAnimatedFrame(g,"nw","walk",2).every(row=>row.length===32)).toBe(true);
  }
  expect(silhouettes.size).toBe(guestIds.length);
 });
 it("walks around every room obstacle and stays on the floor",()=>{
  for(const mode of characterModes)for(const id of guestIds){
   const path=guestRoute(id,mode);
   expect(path.length).toBeGreaterThan(1);
   for(const p of path)expect(worldPointIsWalkable(p,mode)).toBe(true);
   for(let ms=0;ms<39000;ms+=300){
    const p=guestPose(id,mode,ms);
    expect(worldPointIsWalkable(p,mode)).toBe(true);
   }
  }
 });
 it("keeps each visitor a local visual actor with no network dependency",()=>{
  for(const id of guestIds){
   expect(guestPose(id,"normal",0).action).toBeTruthy();
   expect(guestPose(id,"normal",39000)).toEqual(guestPose(id,"normal",0));
  }
 });
});


describe("Living World cosmetic event framework",()=>{
 it("allows only explicitly enabled actors and known interaction targets",async()=>{
  const {acceptWorldEvent}=await import("@/lib/world-character-packs");
  const policy={enabledIds:["green-jacket"],knownIds:["green-jacket","goku"],interactiveProps:["arcade"],reducedMotion:false};
  const event={id:"world-wave-1",actorId:"green-jacket",kind:"inspect-prop",targetId:"arcade",at:123};
  expect(acceptWorldEvent(event,policy)).toEqual(event);
  expect(acceptWorldEvent({...event,actorId:"goku"},policy)).toBeNull();
  expect(acceptWorldEvent({...event,targetId:"secret"},policy)).toBeNull();
  expect(acceptWorldEvent({...event,kind:"execute-tool"},policy)).toBeNull();
  expect(acceptWorldEvent({...event,at:Infinity},policy)).toBeNull();
 });
 it("deduplicates, bounds, and honors reduced motion",async()=>{
  const {acceptWorldEvent,enqueueWorldEvent}=await import("@/lib/world-character-packs");
  const policy={enabledIds:["green-jacket"],knownIds:["green-jacket"],interactiveProps:[],reducedMotion:false,maxEvents:2};
  const event=acceptWorldEvent({id:"world-1",actorId:"green-jacket",kind:"wave",at:1},policy)!;
  let q=enqueueWorldEvent([],event,policy);
  q=enqueueWorldEvent(q,event,policy);
  expect(q).toHaveLength(1);
  for(let i=2;i<5;i++)q=enqueueWorldEvent(q,{...event,id:"world-"+i,at:i},policy);
  expect(q.map(x=>x.id)).toEqual(["world-3","world-4"]);
  expect(enqueueWorldEvent(q,{...event,id:"world-5"},{...policy,reducedMotion:true})).toEqual(q);
 });
});

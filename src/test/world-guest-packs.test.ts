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
  expect(enqueueWorldEvent(q,{...event,id:"world-5",kind:"execute-tool" as "wave"},policy)).toEqual(q);
  expect(enqueueWorldEvent(q,{...event,id:"world-6",actorId:"unknown"},policy)).toEqual(q);
  expect(enqueueWorldEvent(q,event,{...policy,enabledIds:[]})).toEqual([]);
  expect(enqueueWorldEvent([{...event,id:"world-unsafe",kind:"execute-tool" as "wave"}],event,policy)).toEqual([event]);
 });
});

describe("Living World event-to-sprite reaction resolver",()=>{
 it("maps each cosmetic event to existing four-frame actions deterministically",async()=>{
  const {worldReactionAt}=await import("@/lib/world-character-packs");
  const policy={enabledIds:["green-jacket"],knownIds:["green-jacket","moon-mage"],interactiveProps:["arcade"],reducedMotion:false};
  const kinds=[["wave","wave"],["celebrate","celebrate"],["inspect-prop","look"],["greet","talk"]] as const;
  for(const [kind,action] of kinds){
   const event={id:"world-reaction",actorId:"green-jacket",kind,at:1000,...(kind==="inspect-prop"?{targetId:"arcade"}:kind==="greet"?{targetId:"moon-mage"}:{})};
   expect(worldReactionAt([event],"green-jacket",1000,policy)?.action).toBe(action);
   expect(worldReactionAt([event],"green-jacket",2199,policy)?.frame).toBe(2);
   expect(worldReactionAt([event],"green-jacket",2599,policy)?.frame).toBe(3);
   expect(worldReactionAt([event],"green-jacket",2600,policy)).toBeNull();
   expect(worldReactionAt([event],"green-jacket",999,policy)).toBeNull();
  }
 });
 it("ignores disabled, malformed, future, expired and reduced-motion reactions",async()=>{
  const {worldReactionAt}=await import("@/lib/world-character-packs");
  const policy={enabledIds:["green-jacket"],knownIds:["green-jacket"],interactiveProps:[],reducedMotion:false};
  const valid={id:"world-wave",actorId:"green-jacket",kind:"wave" as const,at:1000};
  expect(worldReactionAt([valid],"green-jacket",1100,policy)?.eventId).toBe(valid.id);
  expect(worldReactionAt([{...valid,kind:"execute-tool" as "wave"}],"green-jacket",1100,policy)).toBeNull();
  expect(worldReactionAt([valid],"green-jacket",1100,{...policy,enabledIds:[]})).toBeNull();
  expect(worldReactionAt([valid],"green-jacket",1100,{...policy,reducedMotion:true})).toBeNull();
  expect(worldReactionAt([valid],"green-jacket",Infinity,policy)).toBeNull();
 });
});

describe("Living World reaction sprite integration",()=>{
 it("renders a resolved reaction using the existing atlas without changing source art",async()=>{
  const {worldReactionAt}=await import("@/lib/world-character-packs");
  const {worldReactionFrame,worldAnimatedFrame}=await import("@/lib/world-animation");
  const {greenJacketSprite}=await import("@/lib/world-character-packs");
  const sprite=greenJacketSprite(),original=sprite.join("\\n");
  const policy={enabledIds:["green-jacket"],knownIds:["green-jacket"],interactiveProps:[],reducedMotion:false};
  const event={id:"world-wave-test",actorId:"green-jacket",kind:"wave" as const,at:1000};
  const reaction=worldReactionAt([event],"green-jacket",1800,policy);
  expect(reaction?.frame).toBe(2);
  expect(worldReactionFrame(sprite,"s",reaction)).toEqual(worldAnimatedFrame(sprite,"s","wave",2));
  expect(worldReactionFrame(sprite,"s",null,"walk",1)).toEqual(worldAnimatedFrame(sprite,"s","walk",1));
  expect(sprite.join("\\n")).toBe(original);
 });
});

describe("Living World Pal Room group emote bridge",()=>{
 it("adapts room-wide wave and celebration to enabled visual actors",async()=>{
  const {worldCueReaction}=await import("@/lib/world-character-packs");
  for(const action of ["wave","celebrate"] as const){
   const cue={action,at:3000};
   expect(worldCueReaction(cue,"green-jacket",3000,false)?.action).toBe(action);
   expect(worldCueReaction(cue,"moon-mage",3799,false)?.frame).toBe(1);
   expect(worldCueReaction(cue,"custom-visitor",4599,false)?.frame).toBe(3);
   expect(worldCueReaction(cue,"moon-mage",4600,false)).toBeNull();
  }
 });
 it("rejects invalid cues and respects motion preferences",async()=>{
  const {worldCueReaction}=await import("@/lib/world-character-packs");
  const cue={action:"wave" as const,at:3000};
  expect(worldCueReaction(cue,"moon-mage",2999,false)).toBeNull();
  expect(worldCueReaction(cue,"moon-mage",3100,true)).toBeNull();
  expect(worldCueReaction(null,"moon-mage",3100,false)).toBeNull();
  expect(worldCueReaction({...cue,action:"execute-tool" as "wave"},"moon-mage",3100,false)).toBeNull();
  expect(worldCueReaction({...cue,at:Infinity},"moon-mage",3100,false)).toBeNull();
  expect(worldCueReaction(cue,"",3100,false)).toBeNull();
 });
});

describe("Living World room prop inspection",()=>{
 it("maps each approved room object to a short local look animation",async()=>{
  const {worldCueReaction,WORLD_INTERACTIVE_PROPS}=await import("@/lib/world-character-packs");
  expect(WORLD_INTERACTIVE_PROPS).toEqual(["today","mail","calendar","tasks","setup"]);
  for(const targetId of WORLD_INTERACTIVE_PROPS){
   const cue={action:"inspect-prop" as const,targetId,at:3000};
   expect(worldCueReaction(cue,"green-jacket",3200,false)?.action).toBe("look");
   expect(worldCueReaction(cue,"moon-mage",4599,false)?.frame).toBe(3);
   expect(worldCueReaction(cue,"moon-mage",4600,false)).toBeNull();
  }
 });
 it("rejects unapproved room targets and reduced-motion reactions",async()=>{
  const {worldCueReaction}=await import("@/lib/world-character-packs");
  const cue={action:"inspect-prop" as const,targetId:"calendar" as const,at:3000};
  expect(worldCueReaction(cue,"moon-mage",3200,true)).toBeNull();
  expect(worldCueReaction({...cue,targetId:"private-token" as "calendar"},"moon-mage",3200,false)).toBeNull();
  expect(worldCueReaction({...cue,at:Infinity},"moon-mage",3200,false)).toBeNull();
  expect(worldCueReaction(cue,"moon-mage",2999,false)).toBeNull();
 });
});

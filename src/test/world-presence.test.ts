import {afterEach,describe,expect,it} from "vitest";
import {clearWorldPresence,publishWorldPresence,setWorldFixtureUse,worldFixtureInUse,worldGreeting,worldPresenceSnapshot,type WorldPresence} from "@/lib/world-presence";
import {selectWorldHdClip,worldHdNeighbours} from "@/lib/world-hd-animation";
import type {WorldHdCharacter,WorldHdClip} from "@/lib/world-hd";

const at=(id:string,x:number,y:number,dwelling=true,time=1000):WorldPresence=>({id,x,y,dwelling,at:time});
afterEach(()=>{for(const entry of worldPresenceSnapshot())clearWorldPresence(entry.id);for(const actor of ["a","b","c"])setWorldFixtureUse(actor,"normal",null);});
describe("Living World greetings and furniture use (cosmetic, in-memory)",()=>{
 it("turns a standing actor toward the nearest standing neighbour",()=>{
  const self=at("a",40,60),others=[self,at("b",46,60),at("c",36,60,true)];
  expect(worldGreeting(self,others,1200)).toEqual({partner:"c",facing:"w"});
  expect(worldGreeting(at("b",46,60),others,1200)).toEqual({partner:"a",facing:"w"});
 });
 it("ignores walkers, stale entries, distant actors and itself",()=>{
  const self=at("a",40,60);
  expect(worldGreeting(self,[self],1000)).toBeNull();
  expect(worldGreeting(self,[at("b",42,60,false)],1000)).toBeNull();
  expect(worldGreeting(self,[at("b",42,60,true,0)],5000)).toBeNull();
  expect(worldGreeting(self,[at("b",70,60)],1000)).toBeNull();
  expect(worldGreeting({...self,dwelling:false},[at("b",42,60)],1000)).toBeNull();
 });
 it("keeps a bounded per-tab presence list",()=>{
  publishWorldPresence(at("a",1,1));publishWorldPresence(at("a",2,2));publishWorldPresence(at("b",3,3));
  expect(worldPresenceSnapshot().map(entry=>entry.id).sort()).toEqual(["a","b"]);
  clearWorldPresence("a");
  expect(worldPresenceSnapshot().map(entry=>entry.id)).toEqual(["b"]);
 });
 it("lights furniture only while someone uses it",()=>{
  setWorldFixtureUse("a","normal","terminals");
  setWorldFixtureUse("b","normal","terminals");
  expect(worldFixtureInUse("normal","terminals")).toBe(true);
  expect(worldFixtureInUse("dcc","terminals")).toBe(false);
  setWorldFixtureUse("a","normal","table");
  expect(worldFixtureInUse("normal","table")).toBe(true);
  setWorldFixtureUse("b","normal",null);
  expect(worldFixtureInUse("normal","terminals")).toBe(false);
 });
});

const clip=(name:string):WorldHdClip=>({frames:[{src:name,durationMs:120}],loop:true});
describe("HD256 nearest supplied direction",()=>{
 const art:WorldHdCharacter={version:1,artStatus:"prototype",movement:"humanoid",directions:{
  s:{idle:clip("s-idle")},e:{idle:clip("e-idle"),walk:clip("e-walk")},n:{idle:clip("n-idle")},
 }};
 it("uses a 45° neighbour's real clip when a direction has no art at all",()=>{
  expect(selectWorldHdClip(art,"se","walk")).toMatchObject({direction:"e",action:"walk"});
  expect(selectWorldHdClip(art,"ne","walk")).toMatchObject({direction:"e",action:"walk"});
  expect(selectWorldHdClip(art,"sw","walk")).toMatchObject({direction:"s",action:"idle"});
  expect(selectWorldHdClip(art,"nw","wave")).toMatchObject({direction:"n",action:"idle"});
 });
 it("prefers a direction's own idle over borrowing, and never invents art",()=>{
  expect(selectWorldHdClip(art,"n","walk")).toMatchObject({direction:"n",action:"idle"});
  expect(selectWorldHdClip(art,"w","walk").clip.frames[0]!.src).toBe("s-idle");
  expect(worldHdNeighbours("se")).toEqual(["s","e"]);
  const frontOnly:WorldHdCharacter={version:1,artStatus:"prototype",movement:"humanoid",directions:{s:{idle:clip("s-idle"),walk:clip("s-walk")}}};
  expect(selectWorldHdClip(frontOnly,"e","walk")).toMatchObject({direction:"s",action:"walk"});
  expect(selectWorldHdClip(frontOnly,"e","wave")).toMatchObject({direction:"s",action:"idle"});
  expect(worldHdNeighbours("n")).toHaveLength(2);
 });
});

import {worldLabelCovered} from "@/lib/world-presence";
describe("Living World name labels never stack",()=>{
 const scene={w:800,h:465};
 const actor=(id:string,x:number,y:number):WorldPresence=>({id,x,y,dwelling:true,at:1000,sprite:{w:64,h:76},label:{w:70,h:14}});
 it("hides the label of a character standing just behind a nearer one",()=>{
  const back=actor("back",50,60),front=actor("front",51,64);
  expect(worldLabelCovered(back,[back,front],scene,1100)).toBe(true);   // front body covers back's label
  expect(worldLabelCovered(front,[back,front],scene,1100)).toBe(false); // nearer label always stays
 });
 it("hides the deeper of two side-by-side labels and keeps distant labels",()=>{
  const a=actor("a",50,70),b=actor("b",54,70.4);
  expect(worldLabelCovered(a,[a,b],scene,1100)).toBe(true);
  expect(worldLabelCovered(b,[a,b],scene,1100)).toBe(false);
  const far=actor("far",80,70);
  expect(worldLabelCovered(a,[a,far],scene,1100)).toBe(false);
 });
 it("breaks exact ties deterministically and ignores stale or unsized entries",()=>{
  const a=actor("a",50,70),b=actor("b",50,70);
  expect(worldLabelCovered(a,[a,b],scene,1100)).toBe(true);
  expect(worldLabelCovered(b,[a,b],scene,1100)).toBe(false);
  expect(worldLabelCovered(a,[a,{...b,at:0}],scene,5000)).toBe(false);
  const {label:_unsized,...unsized}=a;
  expect(worldLabelCovered(unsized,[a,b],scene,1100)).toBe(false);
 });
});
describe("measured label boxes (any anchoring)",()=>{
 it("uses measured on-screen rectangles when present",()=>{
  const back:WorldPresence={id:"back",x:0,y:40,dwelling:true,at:1000,labelRect:{l:100,t:200,r:170,b:214}};
  const front:WorldPresence={id:"front",x:0,y:45,dwelling:true,at:1000,spriteRect:{l:110,t:150,r:174,b:226}};
  expect(worldLabelCovered(back,[back,front],{w:800,h:465},1100)).toBe(true);
  const clear:WorldPresence={...front,spriteRect:{l:300,t:150,r:364,b:226}};
  expect(worldLabelCovered(back,[back,clear],{w:800,h:465},1100)).toBe(false);
 });
});

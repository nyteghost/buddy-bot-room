import {describe,expect,it} from "vitest";
import {worldHdCoverage} from "@/lib/world-hd-animation";
import type {WorldHdCharacter,WorldHdClip} from "@/lib/world-hd";

const clip=(frames:number,loop=true):WorldHdClip=>({frames:Array.from({length:frames},(_,i)=>({src:"f"+i,durationMs:120})),loop});
const eight=(make:()=>WorldHdCharacter["directions"]["s"])=>Object.fromEntries((["s","se","e","ne","n","nw","w","sw"] as const).map(d=>[d,make()])) as WorldHdCharacter["directions"];
describe("HD256 coverage summary shown to the owner",()=>{
 it("separates real multi-frame clips from single held poses and lists what the room lacks",()=>{
  const carl:WorldHdCharacter={version:2,artStatus:"prototype",movement:"humanoid",directions:eight(()=>({idle:clip(1),walk:clip(2),run:clip(1,false),signature:clip(1,false)}))};
  const c=worldHdCoverage(carl);
  expect(c.facings).toBe(8);expect(c.walkingFacings).toBe(8);
  expect(c.animated).toEqual(["walk"]);
  expect(c.poses.sort()).toEqual(["run","signature"]);
  expect(c.missing).toContain("wave");expect(c.missing).toContain("talk");
  expect(c.summary).toMatch(/^Prototype · 8\/8 facings · 2-frame walk in 8\/8/);
 });
 it("flags front-only and idle-only packs plainly",()=>{
  const lindon:WorldHdCharacter={version:2,artStatus:"prototype",movement:"humanoid",directions:{s:{idle:clip(1)}}};
  const c=worldHdCoverage(lindon);
  expect(c.facings).toBe(1);expect(c.walkingFacings).toBe(0);
  expect(c.summary).toContain("1/8 facings");expect(c.summary).toContain("no walk cycle");
  expect(c.missing[0]).toBe("walk");
 });
 it("states the production label as the author's claim, not app certification",()=>{
  const full:WorldHdCharacter={version:1,artStatus:"production-approved",movement:"humanoid",directions:eight(()=>({idle:clip(4),walk:clip(6),wave:clip(6,false),talk:clip(3),celebrate:clip(6,false)}))};
  expect(worldHdCoverage(full).summary).toMatch(/^Marked production-approved by pack author/);
 });
});

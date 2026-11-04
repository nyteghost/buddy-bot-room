import {describe,expect,it} from "vitest";
import {agents} from "@/lib/agents";
import {characterModes} from "@/lib/hellraiser";
import {worldPath,worldPointIsWalkable,worldPose,worldRoomPlan,worldRoute} from "@/lib/world-navigation";
describe("Living World furniture navigation",()=>{
 it("maps all themed floors without a path through furniture",()=>{
  for(const theme of characterModes)for(const pal of agents){
   const route=worldRoute(pal.id,theme);
   expect(route.length).toBeGreaterThan(1);
   for(const p of route)expect(worldPointIsWalkable(p,theme)).toBe(true);
   for(let i=1;i<route.length;i++){
    const before=route[i-1]!,after=route[i]!;
    expect(Math.hypot(before.x-after.x,before.y-after.y)).toBeLessThanOrEqual(4.25);
   }
  }
 });
 it("walkers remain on the room floor and avoid solid objects at every animation sample",()=>{
  for(const theme of characterModes.filter(t=>!["linux","assistant","devteam"].includes(t))){
   for(const [i,pal] of agents.entries()){
    for(let ms=0;ms<32000;ms+=125){
     const p=worldPose(pal.id,i,ms,theme);
     expect(worldPointIsWalkable(p,theme)).toBe(true);
    }
    expect(worldPose(pal.id,i,0,theme).walking).toBe(false);
    expect(worldPose(pal.id,i,8000,theme).walking).toBe(true);
    expect(worldPose(pal.id,i,18000,theme).action).toBeTruthy();
   }
  }
 });
 it("returns to the same anchor each loop without teleporting",()=>{
  for(const theme of characterModes){
   const a=worldPose("byte",1,0,theme);
   const b=worldPose("byte",1,32000,theme);
   if(["linux","assistant","devteam"].includes(theme))continue;
   expect(a.x).toBeCloseTo(b.x);expect(a.y).toBeCloseTo(b.y);
  }
 });
 it("chooses a valid escape around the center obstacle",()=>{
  const theme="normal";
  const plan=worldRoomPlan(theme);
  expect(plan.obstacles.length).toBeGreaterThan(0);
  const path=worldPath({x:48,y:44},{x:49,y:78},theme);
  expect(path.length).toBeGreaterThan(2);
  for(const p of path)expect(worldPointIsWalkable(p,theme)).toBe(true);
 });
});

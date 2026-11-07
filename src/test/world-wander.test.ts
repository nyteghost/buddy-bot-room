import {describe,expect,it} from "vitest";
import {characterModes} from "@/lib/hellraiser";
import {worldPointIsWalkable,worldRoomPlan,worldScreenDistance} from "@/lib/world-floor";
import {WORLD_GAITS,worldGaitOf,worldStepFrame,worldTurnToward,worldWanderPlan,worldWanderPose,type WorldGait} from "@/lib/world-wander";
import {guestStart,guestWanderPose} from "@/lib/world-guest-packs";
import {WORLD_PAL_PERIOD,worldPose} from "@/lib/world-navigation";

const gaits=Object.keys(WORLD_GAITS) as WorldGait[];
describe("Living World wandering",()=>{
 it("stays on open floor and never jumps, for every theme and gait",()=>{
  for(const theme of characterModes)for(let slot=0;slot<10;slot++){
   const gait=gaits[slot%gaits.length]!;
   const plan=worldWanderPlan({theme,seed:"test-"+slot,start:guestStart(slot,theme),gait,legs:7});
   let previous=worldWanderPose(plan,0);
   for(let ms=0;ms<=plan.period;ms+=40){
    const pose=worldWanderPose(plan,ms);
    expect(worldPointIsWalkable(pose,theme)).toBe(true);
    // Fastest gait is 7% of width per second (≈12% of height): well under 1% per 40ms.
    expect(Math.hypot(pose.x-previous.x,pose.y-previous.y)).toBeLessThan(0.8);
    previous=pose;
   }
  }
 });
 it("loops seamlessly and is deterministic",()=>{
  const plan=worldWanderPlan({theme:"dcc",seed:"loop",start:guestStart(2,"dcc"),legs:6});
  for(const ms of [0,1234,plan.period/3,plan.period-1])expect(worldWanderPose(plan,ms+plan.period)).toEqual(worldWanderPose(plan,ms));
  expect(worldWanderPose(plan,-500)).toEqual(worldWanderPose(plan,plan.period-500));
  expect(worldWanderPose(plan,Number.NaN)).toEqual(worldWanderPose(plan,0));
  expect(worldWanderPlan({theme:"dcc",seed:"loop",start:guestStart(2,"dcc"),legs:6})).toBe(plan);
 });
 it("walks at a steady gait speed regardless of route length",()=>{
  for(const gait of gaits){
   const plan=worldWanderPlan({theme:"normal",seed:"speed-"+gait,start:guestStart(0,"normal"),gait,legs:7});
   for(const segment of plan.segments){
    if(segment.kind!=="walk")continue;
    const duration=segment.end-segment.start,cruise=segment.distance/WORLD_GAITS[gait].speed*1000;
    expect(duration).toBeGreaterThanOrEqual(Math.round(cruise));
    expect(duration).toBeLessThanOrEqual(Math.round(cruise+WORLD_GAITS[gait].ramp)+1);
    // Mid-walk screen speed equals the gait's cruising speed.
    if(duration>2*segment.ramp+200){
     const mid=segment.start+duration/2,a=worldWanderPose(plan,mid-50),b=worldWanderPose(plan,mid+50);
     if(a.walking&&b.walking&&a.facing===b.facing)expect(worldScreenDistance(a,b)*10).toBeCloseTo(WORLD_GAITS[gait].speed,0);
    }
   }
  }
 });
 it("visits several distinct stops and uses furniture facing it",()=>{
  for(const theme of ["normal","dcc","matrix","finalfantasy","cyberpunk"] as const){
   const fixtures=new Map(worldRoomPlan(theme).fixtures.map(f=>[f.id,f]));
   let used=0,stops=new Set<string>();
   for(let slot=0;slot<8;slot++){
    const plan=worldWanderPlan({theme,seed:"stops-"+slot,start:guestStart(slot,theme),legs:7});
    for(const segment of plan.segments)if(segment.kind==="dwell")stops.add(segment.stop.point.x+","+segment.stop.point.y);
    for(let ms=0;ms<plan.period;ms+=100){
     const pose=worldWanderPose(plan,ms);
     if(pose.action==="interaction"){
      used++;
      expect(fixtures.has(pose.fixture!)).toBe(true);
      expect(pose.facing).toBe(fixtures.get(pose.fixture!)!.facing);
     }
    }
   }
   expect(used).toBeGreaterThan(0);
   expect(stops.size).toBeGreaterThan(6);
  }
 });
 it("turns in place one 45° step at a time the short way round",()=>{
  expect(worldTurnToward("n","s",0)).toEqual({facing:"n",turning:true});
  expect(worldTurnToward("e","w",115).facing).toBe("se");
  expect(worldTurnToward("nw","ne",115)).toEqual({facing:"n",turning:true});
  expect(worldTurnToward("nw","ne",220)).toEqual({facing:"ne",turning:false});
  expect(worldTurnToward("s","s",0)).toEqual({facing:"s",turning:false});
 });
 it("plants footsteps by distance and maps pack movement to a gait",()=>{
  expect(worldStepFrame({walking:false,travelled:9},"humanoid")).toBe(0);
  const stride=WORLD_GAITS.humanoid.stride/2;
  expect(worldStepFrame({walking:true,travelled:stride*1.01},"humanoid")).toBe(1);
  expect(worldStepFrame({walking:true,travelled:stride*5.01},"humanoid")).toBe(1);
  expect(worldGaitOf("floating")).toBe("floating");
  expect(worldGaitOf("teleporting")).toBe("humanoid");
  expect(worldGaitOf(undefined)).toBe("humanoid");
 });
 it("keeps each Pal on a 32-second neighbourhood loop starting at home",()=>{
  const ids=["nova","byte","sage","pip","echo","rune","claude","saiyan","mimic"] as const;
  for(const theme of ["normal","hellraiser","horror","matrix","finalfantasy","cyberpunk","dcc"] as const){
   ids.forEach((id,index)=>{
    const home=worldRoomPlan(theme).homes[index]!;
    const start=worldPose(id,0,0,theme);
    expect(start.walking).toBe(false);
    expect(Math.hypot(start.x-home.x,start.y-home.y)).toBeLessThanOrEqual(3);
    expect(worldPose(id,index,777+WORLD_PAL_PERIOD,theme)).toEqual(worldPose(id,index,777,theme));
   });
  }
 });
 it("gives guests their own itineraries and stays put while the clock is paused",()=>{
  const a=guestWanderPose("moon-mage",2,"normal",9000),b=guestWanderPose("arcade-ghost",3,"normal",9000,"floating");
  expect(a).not.toEqual(b);
  expect(guestWanderPose("moon-mage",2,"normal",9000)).toEqual(a);
 });
});

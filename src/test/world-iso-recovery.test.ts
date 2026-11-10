import { describe, expect, it } from "vitest";
import { WorldIsoCrowd } from "@/lib/world-iso-crowd";
import { worldIsoSealPlan, worldIsoPointFree, worldIsoSegmentClear } from "@/lib/world-iso-ground";

const square = (side = 10, colliders: unknown[] = []) => worldIsoSealPlan({
 id: "synthetic-crowd", floor: [{u:0,v:0},{u:side,v:0},{u:side,v:side},{u:0,v:side}],
 colliders, anchors: [{id:"door", kind:"door", at:{u:1,v:1}, facing:"s"}], door:"door",
})!;
const dist = (a: {u:number;v:number}, b:{u:number;v:number}) => Math.hypot(a.u-b.u,a.v-b.v);

describe("P1/P2 crowd movement and recovery regressions", () => {
 it("resolves the exact two-actor head-on deadlock without intersection, teleport or exceeding 25s wait", () => {
  const crowd = new WorldIsoCrowd(square());
  expect(crowd.join({id:"pal:a",kind:"pal",at:{u:4,v:4}})).toBe(true);
  expect(crowd.join({id:"visitor:z",kind:"visitor",at:{u:4.6,v:4}})).toBe(true);
  expect(crowd.assign("pal:a",{u:8,v:4})).toBe(true);
  expect(crowd.assign("visitor:z",{u:2,v:4})).toBe(true);
  let previous = crowd.snapshot();
  for (let i=0;i<500;i++) {
   crowd.step(100);
   const now = crowd.snapshot();
   expect(crowd.valid()).toBe(true);
   for (const pose of now) {
    const old = previous.find(p=>p.id===pose.id)!;
    expect(dist(old.at,pose.at)).toBeLessThanOrEqual(0.161);
   }
   previous = now;
   if (now.every(p=>p.status==="arrived")) break;
  }
  const end = crowd.snapshot();
  expect(end.every(p=>p.status==="arrived")).toBe(true);
  expect(dist(end.find(p=>p.id==="pal:a")!.at,{u:8,v:4})).toBeLessThan(0.01);
  expect(dist(end.find(p=>p.id==="visitor:z")!.at,{u:2,v:4})).toBeLessThan(0.01);
  expect(crowd.diagnostics().recoveryAttempts).toBeGreaterThan(0);
  expect(crowd.diagnostics().maxWaitMs).toBeLessThan(25_000);
 }, 30_000);

 it("keeps each short route leg clear and accumulates true polyline distance around a desk corner", () => {
  const plan = square(8, [{id:"desk",u1:3,v1:3,u2:5,v2:5}]);
  const radius = 0.1;
  const start = {u:2.89,v:3.05}, finish={u:3.05,v:2.89};
  expect(worldIsoPointFree(plan,start,radius)).toBe(true);
  expect(worldIsoPointFree(plan,finish,radius)).toBe(true);
  expect(worldIsoSegmentClear(plan,start,finish,radius)).toBe(false);
  const crowd = new WorldIsoCrowd(plan,radius);
  expect(crowd.join({id:"corner",kind:"pal",at:start})).toBe(true);
  expect(crowd.assign("corner",finish)).toBe(true);
  let seenMotion=false;
  for(let i=0;i<40;i++){
   const before=crowd.pose("corner")!;
   crowd.step(200);
   const after=crowd.pose("corner")!;
   if(after.walked>before.walked) seenMotion=true;
   expect(crowd.valid()).toBe(true);
   expect(dist(before.at,after.at)).toBeLessThanOrEqual(0.321);
  }
  expect(seenMotion).toBe(true);
  expect(dist(crowd.pose("corner")!.at,finish)).toBeLessThan(0.01);
  expect(crowd.pose("corner")!.walked).toBeGreaterThan(dist(start,finish));
 }, 30_000);

 it("does not falsely arrive at a reserved workstation; retries safely after it is vacated", () => {
  const crowd = new WorldIsoCrowd(square());
  expect(crowd.join({id:"pal:owner",kind:"pal",at:{u:5,v:5}})).toBe(true);
  expect(crowd.join({id:"pal:other",kind:"pal",at:{u:2,v:5}})).toBe(true);
  expect(crowd.assign("pal:other",{u:5,v:5})).toBe(false);
  expect(crowd.diagnostics().actors.find(a=>a.id==="pal:other")?.reason).toBe("destination-reserved");
  expect(crowd.pose("pal:other")?.status).toBe("blocked");
  crowd.leave("pal:owner");
  for(let i=0;i<11;i++) crowd.step(200);
  expect(crowd.assign("pal:other",{u:5,v:5})).toBe(true);
  for(let i=0;i<30;i++){crowd.step(200);expect(crowd.valid()).toBe(true);}
  expect(crowd.pose("pal:other")?.status).toBe("arrived");
 });

 it("partitions up to 200ms into equivalent capped substeps and drops suspended time", () => {
  const plan = square();
  const a = new WorldIsoCrowd(plan), b = new WorldIsoCrowd(plan);
  for (const crowd of [a,b]){
   expect(crowd.join({id:"a",kind:"pal",at:{u:2,v:2}})).toBe(true);
   expect(crowd.assign("a",{u:6,v:2})).toBe(true);
  }
  a.step(200);
  b.step(100);b.step(100);
  expect(a.pose("a")!.at).toEqual(b.pose("a")!.at);
  const previous=a.pose("a")!.at;
  a.step(30_000);
  expect(dist(previous,a.pose("a")!.at)).toBeLessThanOrEqual(0.321);
  expect(a.diagnostics().droppedMs).toBeGreaterThan(29_000);
  const before=a.pose("a")!.at;
  a.step(200,true);
  expect(a.pose("a")!.at).toEqual(before);
 });

 it("preserves identity, safe spacing and pose state across joins/removals", () => {
  const crowd = new WorldIsoCrowd(square());
  expect(crowd.join({id:"pal:one",kind:"pal",at:{u:2,v:2}})).toBe(true);
  expect(crowd.join({id:"visitor:a",kind:"visitor",at:{u:3,v:2}})).toBe(true);
  crowd.assign("pal:one",{u:7,v:2});
  crowd.step(200);
  const before=crowd.pose("pal:one")!;
  crowd.leave("visitor:a");
  expect(crowd.join({id:"visitor:b",kind:"visitor",at:{u:8,v:8}})).toBe(true);
  expect(crowd.pose("pal:one")!.at).toEqual(before.at);
  expect(crowd.pose("pal:one")!.walked).toBe(before.walked);
  expect(crowd.valid()).toBe(true);
 });
});

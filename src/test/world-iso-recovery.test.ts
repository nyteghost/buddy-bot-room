import { describe, expect, it } from "vitest";
import { WorldIsoCrowd } from "@/lib/world-iso-crowd";
import { worldIsoSealPlan, worldIsoPointFree, worldIsoSegmentClear, worldIsoSegmentDistance } from "@/lib/world-iso-ground";

const square = (side = 10, colliders: unknown[] = []) => worldIsoSealPlan({
 id: "synthetic-crowd", floor: [{u:0,v:0},{u:side,v:0},{u:side,v:side},{u:0,v:side}],
 colliders, anchors: [{id:"door", kind:"door", at:{u:1,v:1}, facing:"s"}], door:"door",
})!;
const dist = (a: {u:number;v:number}, b:{u:number;v:number}) => Math.hypot(a.u-b.u,a.v-b.v);

// Assert true swept actor-to-actor and furniture clearance, not just endpoint spacing.
const checkSafeStep=(crowd:WorldIsoCrowd,ms:number):void=>{
 const previous=crowd.snapshot();
 crowd.step(ms);
 const current=crowd.snapshot();
 expect(crowd.valid()).toBe(true);
 for(const p of current){
  const old=previous.find(x=>x.id===p.id)!;
  expect(dist(p.at,old.at)).toBeLessThanOrEqual(ms/1000*1.6+0.001);
  expect(worldIsoSegmentClear(crowd.plan,old.at,p.at,crowd.radius)).toBe(true);
 }
 for(let i=0;i<current.length;i++)for(let j=i+1;j<current.length;j++){
  const a=current[i]!,b=current[j]!;
  const aa=previous.find(x=>x.id===a.id)!,bb=previous.find(x=>x.id===b.id)!;
  expect(worldIsoSegmentDistance(aa.at,a.at,bb.at,b.at))
   .toBeGreaterThanOrEqual(2*crowd.radius-1e-6);
 }
};

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
  expect(crowd.assign("pal:owner",{u:5,v:5})).toBe(true); // explicit workstation reservation
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
 it("does not create a ghost reservation after a denied claim is superseded", () => {
  const crowd = new WorldIsoCrowd(square());
  for (const [id, u] of [["A", 2], ["B", 4], ["C", 6]] as const)
   expect(crowd.join({id,kind:"pal",at:{u,v:2}})).toBe(true);
  const x={u:8,v:8}, y={u:8,v:7};
  expect(crowd.assign("A",x)).toBe(true);
  expect(crowd.assign("B",x)).toBe(false);
  expect(crowd.diagnostics().actors.find(a=>a.id==="B")).toMatchObject({
   status:"blocked", reserved:false, arrived:false, reason:"destination-reserved",
  });
  expect(crowd.assign("A",y)).toBe(true);
  // No schedule reset, actor move, or 2s retry is required.
  expect(crowd.assign("C",x)).toBe(true);
  const d=crowd.diagnostics();
  expect(d.actors.find(a=>a.id==="C")?.reserved).toBe(true);
  expect(d.actors.find(a=>a.id==="B")?.reserved).toBe(false);
  expect(d.goals.find(g=>g.actorId==="B")?.outcome).toBe("rejected");
  expect(crowd.valid()).toBe(true);
 });

 it("preserves first rejection time over 60s of identical denied requests and records new terminal goals separately",()=>{
  const crowd=new WorldIsoCrowd(square());
  for(const [id,u] of [["A",2],["B",4]] as const)
   expect(crowd.join({id,kind:"pal",at:{u,v:2}})).toBe(true);
  const x={u:8,v:8};
  expect(crowd.assign("A",x)).toBe(true);
  expect(crowd.assign("B",x)).toBe(false);
  const initial=crowd.diagnostics().goals.find(g=>g.actorId==="B")!;
  expect(initial.outcome).toBe("rejected");
  expect(initial.requestAtMs).toBe(0);
  expect(initial.finishedAtMs).toBe(0);
  crowd.step(100);
  expect(crowd.diagnostics().goals.find(g=>g.sequence===initial.sequence)?.finishedAtMs).toBe(0);
  for(let i=1;i<600;i++){
   expect(crowd.assign("B",x)).toBe(false);
   crowd.step(100);
   if(i%20===0){
    const g=crowd.diagnostics().goals.find(g=>g.sequence===initial.sequence)!;
    expect(g.finishedAtMs).toBe(0);
    expect(g.requestAtMs).toBe(0);
    expect(g.outcome).toBe("rejected");
    expect(crowd.diagnostics().actors.find(a=>a.id==="B")).toMatchObject({
     arrived:false,reserved:false,reason:"destination-reserved",
    });
   }
  }
  const d=crowd.diagnostics(),rejected=d.goals.find(g=>g.sequence===initial.sequence)!;
  expect(rejected.finishedAtMs).toBe(0);
  expect(rejected.requestAtMs).toBe(0);
  expect(rejected.blockedMs).toBeGreaterThanOrEqual(59_900);
  expect(rejected.maxContinuousBlockedMs).toBeGreaterThanOrEqual(59_900);
  expect(rejected.maxNonProgressMs).toBeGreaterThanOrEqual(59_900);
  expect(d.actors.find(a=>a.id==="B")).toMatchObject({arrived:false,reserved:false});
  expect(d.goals.filter(g=>g.actorId==="B")).toHaveLength(1);
  // A genuinely different request has its own sequence and first terminal event.
  expect(crowd.assign("B",{u:NaN,v:2})).toBe(false);
  const distinct=crowd.diagnostics().goals.filter(g=>g.actorId==="B");
  expect(distinct).toHaveLength(2);
  expect(distinct[1]!.sequence).not.toBe(initial.sequence);
  expect(distinct[1]!.requestAtMs).toBe(60_000);
  expect(distinct[1]!.finishedAtMs).toBe(60_000);
  expect(distinct[0]!.finishedAtMs).toBe(0);
  crowd.step(100);
  expect(crowd.diagnostics().goals.find(g=>g.sequence===distinct[1]!.sequence)?.finishedAtMs)
   .toBe(60_000);
 });

 it("retains QA's rejection when the freed destination is accepted and eventually reached",()=>{
  const crowd=new WorldIsoCrowd(square());
  expect(crowd.join({id:"A",kind:"pal",at:{u:2,v:2}})).toBe(true);
  expect(crowd.join({id:"B",kind:"pal",at:{u:4,v:2}})).toBe(true);
  const x={u:8,v:8}, y={u:8,v:7};
  expect(crowd.assign("A",x)).toBe(true);
  expect(crowd.assign("B",x)).toBe(false);
  const first=crowd.diagnostics().goals.find(g=>g.actorId==="B")!;
  expect(first).toMatchObject({outcome:"rejected",finishedAtMs:0,arrivalAtMs:null});
  expect(crowd.assign("A",y)).toBe(true);
  const beforeRetry=crowd.diagnostics();
  expect(crowd.assign("B",x)).toBe(false);
  expect(crowd.diagnostics().pathQueries).toBe(beforeRetry.pathQueries);
  expect(crowd.diagnostics().actors.find(a=>a.id==="B"))
   .toMatchObject({reserved:false,arrived:false});
  for(let i=0;i<11;i++)checkSafeStep(crowd,200);
  const held=crowd.diagnostics().goals.find(g=>g.sequence===first.sequence)!;
  expect(crowd.assign("B",x)).toBe(true);
  const retry=crowd.diagnostics().goals.filter(g=>g.actorId==="B").at(-1)!;
  expect(retry.sequence).toBeGreaterThan(first.sequence);
  expect(retry).toMatchObject({actorId:"B",requested:x,requestAtMs:2200,
   reservationAtMs:2200,outcome:"pending",finishedAtMs:null,arrivalAtMs:null});
  expect(crowd.diagnostics().goals.find(g=>g.sequence===first.sequence)).toEqual(held);
  for(let i=0;i<500 && !crowd.diagnostics().actors.find(a=>a.id==="B")!.arrived;i++)
   checkSafeStep(crowd,50);
  expect(crowd.diagnostics().actors.find(a=>a.id==="B"))
   .toMatchObject({reserved:true,arrived:true,status:"arrived"});
  expect(dist(crowd.pose("B")!.at,x)).toBeLessThan(1e-8);
  const end=crowd.diagnostics().goals.find(g=>g.sequence===retry.sequence)!;
  expect(end.outcome).toBe("completed");
  expect(end.arrivalAtMs).toBeGreaterThan(2200);
  expect(end.finishedAtMs).toBe(end.arrivalAtMs);
  expect(crowd.diagnostics().goals.find(g=>g.sequence===first.sequence)).toEqual(held);
  expect(crowd.diagnostics().goals.filter(g=>g.actorId==="B")).toHaveLength(2);
 });

 it("keeps an unreachable terminal event when a later retry fails for a different reason",()=>{
  const crowd=new WorldIsoCrowd(square(10,[{id:"wall",u1:0,v1:4.75,u2:10,v2:5.25}]));
  const x={u:8,v:8};
  expect(crowd.join({id:"A",kind:"pal",at:{u:2,v:2}})).toBe(true);
  expect(crowd.join({id:"B",kind:"pal",at:x})).toBe(true);
  expect(crowd.assign("A",x)).toBe(false);
  const first=crowd.diagnostics().goals[0]!;
  expect(first).toMatchObject({outcome:"unreachable",reason:"no-static-route",finishedAtMs:0});
  expect(crowd.assign("B",x)).toBe(true);
  for(let i=0;i<300;i++){
   checkSafeStep(crowd,200);
   expect(crowd.assign("A",x)).toBe(false);
  }
  expect(crowd.diagnostics().goals.find(g=>g.sequence===first.sequence)).toMatchObject({
   outcome:"unreachable",reason:"no-static-route",finishedAtMs:0,arrivalAtMs:null,reservationAtMs:null,
  });
  expect(crowd.diagnostics().actors.find(a=>a.id==="A"))
   .toMatchObject({reserved:false,arrived:false,reason:"destination-reserved"});
  expect(crowd.diagnostics().goals.filter(g=>g.actorId==="A")).toHaveLength(1);
  // The sealed static barrier cannot become reachable: a different valid request is new.
  expect(crowd.assign("A",{u:3,v:2})).toBe(true);
  for(let i=0;i<20;i++)checkSafeStep(crowd,50);
  expect(crowd.diagnostics().goals.at(-1)?.outcome).toBe("completed");
  expect(crowd.diagnostics().goals[0]!.finishedAtMs).toBe(0);
 });

 it("retains a stalled sequence through schedule refresh and records a separate restart",()=>{
  const crowd=new WorldIsoCrowd(square(10,[
   {id:"south",u1:0,v1:0,u2:10,v2:3.64},
   {id:"north",u1:0,v1:4.36,u2:10,v2:10},
  ]));
  const x={u:8,v:4};
  expect(crowd.join({id:"visitor:a",kind:"visitor",at:{u:4,v:4}})).toBe(true);
  expect(crowd.join({id:"pal:b",kind:"pal",at:{u:4.6,v:4}})).toBe(true);
  expect(crowd.assign("visitor:a",x)).toBe(true);
  expect(crowd.assign("pal:b",{u:4.6,v:4})).toBe(true);
  for(let i=0;i<430;i++)checkSafeStep(crowd,200);
  const first=crowd.diagnostics().goals[0]!;
  expect(first.outcome).toBe("stalled");
  crowd.beginSchedulePeriod();
  expect(crowd.assign("visitor:a",x)).toBe(true);
  const restart=crowd.diagnostics().goals.filter(g=>g.actorId==="visitor:a").at(-1)!;
  expect(restart.sequence).toBeGreaterThan(first.sequence);
  expect(restart).toMatchObject({outcome:"pending",requestAtMs:86000,finishedAtMs:null});
  checkSafeStep(crowd,50);
  expect(crowd.diagnostics().goals.at(-1)?.outcome).toBe("pending");
  for(let i=0;i<300;i++)checkSafeStep(crowd,200);
  expect(crowd.diagnostics().goals.find(g=>g.sequence===first.sequence)).toEqual(first);
  expect(crowd.diagnostics().goals.at(-1)?.outcome).toBe("stalled");
  expect(crowd.diagnostics().actors.find(a=>a.id==="visitor:a")?.arrived).toBe(false);
  // Once the blocker leaves, a schedule restart can arrive on a third sequence.
  crowd.leave("pal:b"); crowd.beginSchedulePeriod();
  expect(crowd.assign("visitor:a",x)).toBe(true);
  for(let i=0;i<200;i++)checkSafeStep(crowd,50);
  expect(crowd.diagnostics().goals.at(-1)?.outcome).toBe("completed");
  expect(crowd.diagnostics().goals.find(g=>g.sequence===first.sequence)).toEqual(first);
  expect(crowd.diagnostics().goals.filter(g=>g.actorId==="visitor:a")).toHaveLength(3);
 });

 it("reports truthful rejection and arrival for nonfinite, malformed, furniture and valid goals", () => {
  const crowd=new WorldIsoCrowd(square(10,[{id:"desk",u1:7,v1:7,u2:9,v2:9}]));
  expect(crowd.join({id:"A",kind:"pal",at:{u:2,v:2}})).toBe(true);
  const invalid: unknown[]=[
   {u:NaN,v:2},{u:Infinity,v:2},{u:-Infinity,v:2},
   {u:"2",v:2},{u:2},{v:2},null,{u:8,v:8},
  ];
  for(const target of invalid){
   expect(crowd.assign("A",target as {u:number;v:number})).toBe(false);
   const actor=crowd.diagnostics().actors[0]!;
   expect(actor.arrived).toBe(false);
   expect(actor.reserved).toBe(false);
   expect(actor.status).toBe("unreachable");
   expect(actor.reason).toBe(target === invalid[invalid.length-1] ?
    "invalid-ground" : "invalid-coordinate");
  }
  expect(crowd.assign("A",{u:4,v:2})).toBe(true);
  expect(crowd.diagnostics().actors[0]!.arrived).toBe(false);
  for(let i=0;i<20;i++)crowd.step(200);
  expect(crowd.diagnostics().actors[0]).toMatchObject({
   status:"arrived", arrived:true, reserved:true,
  });
  expect(crowd.diagnostics().goals.at(-1)?.outcome).toBe("completed");
  expect(crowd.diagnostics().goals.at(-1)?.arrivalAtMs).not.toBeNull();
  const firstArrival=crowd.diagnostics().goals.at(-1)!.arrivalAtMs;
  const firstReservation=crowd.diagnostics().goals.at(-1)!.reservationAtMs;
  crowd.beginSchedulePeriod();
  expect(crowd.assign("A",{u:4,v:2})).toBe(true);
  expect(crowd.diagnostics().goals.at(-1)?.arrivalAtMs).toBe(firstArrival);
  expect(crowd.diagnostics().goals.at(-1)?.reservationAtMs).toBe(firstReservation);
  expect(crowd.diagnostics().goals.filter(g=>g.actorId==="A").at(-1)?.outcome).toBe("completed");
 });

 it("distinguishes a statically valid but unreachable destination", () => {
  const plan=square(10,[{id:"sealed-barrier",u1:0,v1:4.75,u2:10,v2:5.25}]);
  expect(worldIsoPointFree(plan,{u:8,v:8})).toBe(true);
  const crowd=new WorldIsoCrowd(plan);
  expect(crowd.join({id:"A",kind:"pal",at:{u:2,v:2}})).toBe(true);
  expect(crowd.assign("A",{u:8,v:8})).toBe(false);
  expect(crowd.diagnostics().actors[0]).toMatchObject({
   arrived:false, reserved:false, status:"unreachable", reason:"no-static-route",
  });
  expect(crowd.diagnostics().goals.at(-1)?.outcome).toBe("unreachable");
 });

 it("proves C causally intercepts A's active yield and A recovers with both blockers present", () => {
  const crowd=new WorldIsoCrowd(square());
  const id="visitor:a", target={u:8,v:4};
  expect(crowd.join({id,kind:"visitor",at:{u:4,v:4}})).toBe(true);
  expect(crowd.join({id:"pal:b",kind:"pal",at:{u:4.6,v:4}})).toBe(true);
  expect(crowd.assign(id,target)).toBe(true);
  expect(crowd.assign("pal:b",{u:4.6,v:4})).toBe(true);
  // Wait until B has caused an actual sidestep; do not presume its direction.
  for(let i=0;i<20 && !crowd.diagnostics().actors.find(a=>a.id===id)?.yieldTarget;i++)
   checkSafeStep(crowd,50);
  const before=crowd.diagnostics();
  const a=before.actors.find(a=>a.id===id)!;
  const oldYield=a.yieldTarget;
  expect(oldYield).not.toBeNull();
  expect(crowd.pose(id)?.status).toBe("yielding");
  const initialGoal=before.goals.find(g=>g.actorId===id)!;
  expect(initialGoal.recoveryAttempts).toBeGreaterThan(0);
  // C joins AFTER A selects a route. The exact target lies on the
  // active yielding segment and was clear when A first picked it.
  expect(dist(crowd.pose(id)!.at,oldYield!)).toBeGreaterThanOrEqual(.6);
  expect(crowd.join({id:"pal:c",kind:"pal",at:oldYield!})).toBe(true);
  expect(worldIsoSegmentDistance(crowd.pose(id)!.at,oldYield!,oldYield!,oldYield!))
   .toBeLessThan(.6-1e-6);
  let intercept=null as ReturnType<typeof crowd.diagnostics>["goals"][number] | null;
  for(let i=0;i<40;i++){
   checkSafeStep(crowd,100);
   const g=crowd.diagnostics().goals.find(g=>g.sequence===initialGoal.sequence)!;
   if(g.lastYieldInterceptorId==="pal:c"){intercept=g;break;}
  }
  expect(intercept).not.toBeNull(); // fails if C did not intercept the active yielding route
  expect(intercept!.yieldInterceptions).toBeGreaterThan(initialGoal.yieldInterceptions);
  expect(intercept!.lastYieldInterceptedAtMs).toBeGreaterThan(before.simulatedMs);
  expect(intercept!.recoveryAttempts).toBeGreaterThan(initialGoal.recoveryAttempts);
  expect(crowd.diagnostics().actors.find(a=>a.id===id)?.yieldTarget).not.toEqual(oldYield);
  expect(intercept!.requestAtMs).toBe(initialGoal.requestAtMs);
  // B and C stay physically present; removing B would invalidate this oracle.
  for(let i=0;i<250 && crowd.pose(id)?.status!=="arrived";i++) checkSafeStep(crowd,100);
  const final=crowd.diagnostics().goals.find(g=>g.sequence===initialGoal.sequence)!;
  expect(crowd.pose(id)?.status).toBe("arrived");
  expect(dist(crowd.pose(id)!.at,target)).toBeLessThan(.01);
  expect(final.outcome).toBe("completed");
  expect(final.arrivalAtMs).not.toBeNull();
  expect(final.arrivalAtMs!-final.requestAtMs).toBeLessThan(25_000);
  expect(final.requestAtMs).toBe(initialGoal.requestAtMs);
  expect(final.lastYieldInterceptorId).toBe("pal:c");
 },30_000);

 it("proves C intercepts the only side pocket and impossible recovery reports a stable stall", () => {
  // A single upper retreat pocket beside A: B holds the exit and the
  // west, bottom, northeast and pocket-ceiling walls block other sidesteps.
  const pocket=square(10,[
   {id:"west",u1:0,v1:0,u2:3.55,v2:10},
   {id:"south",u1:3.55,v1:0,u2:10,v2:3.64},
   {id:"north-east",u1:4.45,v1:4.36,u2:10,v2:10},
   {id:"pocket-ceiling",u1:3.55,v1:5.36,u2:4.45,v2:10},
  ]);
  const crowd=new WorldIsoCrowd(pocket);
  expect(crowd.join({id:"visitor:a",kind:"visitor",at:{u:4,v:4}})).toBe(true);
  expect(crowd.join({id:"pal:b",kind:"pal",at:{u:4.6,v:4}})).toBe(true);
  expect(crowd.assign("visitor:a",{u:8,v:4})).toBe(true);
  expect(crowd.assign("pal:b",{u:4.6,v:4})).toBe(true);
  for(let i=0;i<20 && !crowd.diagnostics().actors.find(a=>a.id==="visitor:a")?.yieldTarget;i++)
   checkSafeStep(crowd,50);
  const before=crowd.diagnostics();
  const selected=before.actors.find(a=>a.id==="visitor:a")!.yieldTarget;
  expect(selected).not.toBeNull();
  expect(dist(crowd.pose("visitor:a")!.at,selected!)).toBeGreaterThanOrEqual(.6);
  expect(crowd.join({id:"pal:c",kind:"pal",at:selected!})).toBe(true);
  expect(worldIsoSegmentDistance(crowd.pose("visitor:a")!.at,selected!,selected!,selected!))
   .toBeLessThan(.6-1e-6);
  const seq=before.goals.find(g=>g.actorId==="visitor:a")!.sequence;
  let intercepted=false,firstFinished:number|null=null;
  for(let i=0;i<310;i++){
   // Repeats begin AFTER the causal event to avoid preemptive same-goal rerouting.
   if(intercepted && i%5===0)expect(crowd.assign("visitor:a",{u:8,v:4})).toBe(true);
   checkSafeStep(crowd,100);
   const d=crowd.diagnostics(),g=d.goals.find(g=>g.sequence===seq)!;
   if(g.lastYieldInterceptorId==="pal:c"){
    intercepted=true;
    expect(g.yieldInterceptions).toBeGreaterThan(0);
    expect(g.recoveryAttempts).toBeGreaterThan(before.goals.find(g=>g.sequence===seq)!.recoveryAttempts);
   }
   if(g.outcome==="stalled"){
    if(firstFinished===null)firstFinished=g.finishedAtMs;
    expect(g.finishedAtMs).toBe(firstFinished);
   }
  }
  const d=crowd.diagnostics(),goal=d.goals.find(g=>g.sequence===seq)!;
  expect(intercepted).toBe(true);
  expect(goal.lastYieldInterceptorId).toBe("pal:c");
  expect(firstFinished).not.toBeNull();
  expect(goal.outcome).toBe("stalled");
  expect(goal.finishedAtMs).toBe(firstFinished);
  expect(goal.requestAtMs).toBe(0);
  expect(goal.blockedMs).toBeGreaterThan(25_000);
  expect(goal.maxNonProgressMs).toBeGreaterThan(25_000);
  expect(d.actors.find(a=>a.id==="visitor:a")?.arrived).toBe(false);
  expect(d.actors.find(a=>a.id==="visitor:a")?.yieldTarget).toBeNull();
  expect(d.goals.filter(g=>g.actorId==="visitor:a")).toHaveLength(1);
 },30_000);

 it("retains prolonged same-goal blockage rather than laundering it through retries", () => {
  const corridor=square(10,[
   {id:"south",u1:0,v1:0,u2:10,v2:3.64},
   {id:"north",u1:0,v1:4.36,u2:10,v2:10},
  ]);
  const crowd=new WorldIsoCrowd(corridor);
  expect(crowd.join({id:"visitor:a",kind:"visitor",at:{u:4,v:4}})).toBe(true);
  expect(crowd.join({id:"pal:b",kind:"pal",at:{u:4.6,v:4}})).toBe(true);
  expect(crowd.assign("visitor:a",{u:8,v:4})).toBe(true);
  expect(crowd.assign("pal:b",{u:4.6,v:4})).toBe(true);
  const seq=crowd.diagnostics().goals[0]!.sequence;
  for(let i=0;i<300;i++){
   if(i%5===0)expect(crowd.assign("visitor:a",{u:8,v:4})).toBe(true);
   crowd.step(100);
   expect(crowd.valid()).toBe(true);
  }
  const diag=crowd.diagnostics(),goal=diag.goals.find(g=>g.sequence===seq)!;
  expect(diag.actors.find(a=>a.id==="visitor:a")?.arrived).toBe(false);
  expect(diag.actors.find(a=>a.id==="visitor:a")?.status).toBe("blocked");
  expect(goal.outcome).toBe("stalled");
  expect(goal.nonProgressMs).toBeGreaterThanOrEqual(25_000);
  expect(goal.requestAtMs).toBe(0);
  expect(goal.maxContinuousBlockedMs).toBeGreaterThan(0);
  expect(diag.goals.filter(g=>g.actorId==="visitor:a")).toHaveLength(1);
  const firstStallAt=goal.finishedAtMs;
  expect(firstStallAt).not.toBeNull();
  // A truly new request must not erase the prior goal's terminal event.
  const newTarget=crowd.pose("visitor:a")!.at;
  expect(crowd.assign("visitor:a",newTarget)).toBe(true);
  const separate=crowd.diagnostics().goals.filter(g=>g.actorId==="visitor:a");
  expect(separate).toHaveLength(2);
  expect(separate[0]).toMatchObject({
   sequence:seq,outcome:"stalled",requestAtMs:0,finishedAtMs:firstStallAt,
  });
  expect(separate[1]!.sequence).not.toBe(seq);
  expect(separate[1]).toMatchObject({
   outcome:"completed",requestAtMs:30_000,reservationAtMs:30_000,
   arrivalAtMs:30_000,finishedAtMs:30_000,
  });
  crowd.step(100);
  expect(crowd.diagnostics().goals.find(g=>g.sequence===seq)?.finishedAtMs).toBe(firstStallAt);
 });

});

import { describe, expect, it } from "vitest";
import { WorldIsoCrowd } from "@/lib/world-iso-crowd";
import { WORLD_ISO_GREYBOX } from "@/lib/world-iso-greybox";
import { worldIsoSchedule, WORLD_ISO_PAL_IDS, WORLD_ISO_SCHEDULE_PERIOD_MS } from "@/lib/world-iso-schedule";
import { worldIsoPointFree, worldIsoSealPlan, worldIsoSegmentDistance } from "@/lib/world-iso-ground";

/**
 * Run five reproducible 20-minute simulations using the complete 9+6 population.
 * These remain library tests: no browser, private art, Unraid or active room mount.
 * JSON metrics in CI logs allow independent reviewers to inspect actual failures.
 */
const TILE_EPS = 1e-6;
const dist = (a:{u:number;v:number},b:{u:number;v:number}) => Math.hypot(a.u-b.u,a.v-b.v);
const pals = WORLD_ISO_PAL_IDS.map(id => ({ id, name: id, enabled: true, real: null as "focus" | "responding" | null }));
const home = (id:string) => WORLD_ISO_GREYBOX.anchors.find(a=>a.id===id)!.at;
const seeds = [
 "normal-ambient",
 "workstation-return",
 "six-visitor-rotation",
 "head-on-and-doorway",
 "shared-anchor-and-blocked-workstation",
] as const;

describe("five full-population twenty-minute iso crowd stress scenarios", () => {
 for (let seed=0;seed<seeds.length;seed++) {
  it(seeds[seed]!, () => {
   const visitors = Array.from({length:6},(_,i)=>({id:"visitor-"+seed+"-"+i,name:"Visitor "+i}));
   const crowd = new WorldIsoCrowd();
   const initial = worldIsoSchedule(pals,visitors,0);
   expect(initial).toHaveLength(15);
   for (const a of initial) expect(crowd.join({
    id:a.id,kind:a.kind,at:home(a.home),real:!!a.real,
   })).toBe(true);
   let previous = crowd.snapshot(), collisions=0, invalid=0, teleports=0;
   let arrivals=0, unreachable=0, maxWaiting=0, routeFailures=0, totalSteps=0;
   const longWaiters=new Set<string>();
   let lastPeriod=-1;
   const seenArrivals = new Set<string>();
   const beforeHeap=process.memoryUsage().heapUsed;
   const started=performance.now();
   const tickMs=200, totalMs=20*60*1000, ticks=totalMs/tickMs;
   for (let tick=0;tick<ticks;tick++) {
    const time=tick*tickMs;
    const phase=Math.floor(time/WORLD_ISO_SCHEDULE_PERIOD_MS);
    if (phase!==lastPeriod) {
     lastPeriod=phase;
     let inputs=pals;
     if (seed===1 && phase%4===0) inputs=pals.map(p=>({...p,real:"focus" as const}));
     const targets=worldIsoSchedule(inputs,visitors,time);
     for (const a of targets) crowd.setReal(a.id,!!a.real);
     crowd.beginSchedulePeriod();
     for (const a of targets) {
      let target=a.target;
      if(seed===2 && phase%4===2 && a.kind==="visitor"){
       // All six rotate simultaneously through distinct currently occupied homes.
       const index=visitors.findIndex(v=>"custom:"+v.id===a.id);
       target=home("visitor-home-"+((index+1)%6));
      }
      if(seed===3 && phase%4===1 && a.id==="pal:nova") target=home("door");
      if(seed===3 && phase%4===1 && a.id==="pal:byte") target=home("visitor-home-5");
      if(seed===4 && phase%4===2 && a.kind==="visitor") target=home("chat-a1");
      if(seed===4 && phase%4===3 && a.id==="pal:byte") target=home("seat-0");
      if(!crowd.assign(a.id,target)) routeFailures++;
     }
    }
    if (seed===1 && tick===ticks/3) {
     // Rejoining a visitor never resets any permanent Pal.
     const unchanged=crowd.pose("pal:nova")!;
     const id="custom:"+visitors[5]!.id;
     crowd.leave(id);
     let rejoined=false;
     // Re-entry uses a genuinely empty safe anchor, never a teleport into
     // an occupied home. Preserve all existing Pal positions.
     for (const anchor of WORLD_ISO_GREYBOX.anchors) {
      if (crowd.join({id,kind:"visitor",at:anchor.at})) { rejoined=true; break; }
     }
     expect(rejoined).toBe(true);
     previous=previous.filter(p=>p.id!==id); // a new life is not a movement tick
     expect(crowd.pose("pal:nova")!.at).toEqual(unchanged.at);
    }
    if (seed===3 && tick%300===0) {
     crowd.step(0,true); // pause, followed by normal motion
    }
    crowd.step(tick===ticks-1 ? 1_000 : tickMs);
    totalSteps++;
    const now=crowd.snapshot();
    for(let i=0;i<now.length;i++){
     const actor=now[i]!, old=previous.find(a=>a.id===actor.id);
     if(!worldIsoPointFree(WORLD_ISO_GREYBOX,actor.at)) invalid++;
     if(old && dist(actor.at,old.at) > .321 + TILE_EPS) teleports++;
     for(let j=i+1;j<now.length;j++) if(dist(actor.at,now[j]!.at)<.6-TILE_EPS) collisions++;
     if(actor.waitMs>maxWaiting) maxWaiting=actor.waitMs;
     if(actor.waitMs>=25_000) longWaiters.add(actor.id);
     if(actor.status==="unreachable" || actor.status==="blocked") unreachable++;
     if(actor.status==="arrived" && !seenArrivals.has(actor.id+":"+phase)){
      arrivals++;seenArrivals.add(actor.id+":"+phase);
     }
    }
    previous=now;
   }
   const wallElapsedMs=performance.now()-started;
   const heapDeltaBytes=process.memoryUsage().heapUsed-beforeHeap;
   const metrics=crowd.diagnostics();
   const goals=metrics.goals;
   const counts=Object.fromEntries(
    ["pending","completed","rejected","unreachable","canceled","stalled"]
     .map(outcome=>[outcome,goals.filter(g=>g.outcome===outcome).length]));
   const summary={seed:seeds[seed],simulatedMinutes:20,actors:15,ticks:totalSteps,
    collisions,invalidGroundPositions:invalid,teleportViolations:teleports,
    actorPeriodArrivalSamples:arrivals,blockedOrUnreachableActorTickSamples:unreachable,maxWaitingMs:maxWaiting,
    waitThresholdViolations:longWaiters.size,
    distinctGoalRequests:goals.length,logicalGoalOutcomes:counts,
    maxGoalAgeMs:Math.max(0,...goals.map(g=>(g.finishedAtMs??metrics.simulatedMs)-g.requestAtMs)),
    maxPerGoalBlockedMs:Math.max(0,...goals.map(g=>g.blockedMs)),
    maxContinuousGoalBlockedMs:Math.max(0,...goals.map(g=>g.maxContinuousBlockedMs)),
    maxGoalNoProgressMs:Math.max(0,...goals.map(g=>g.maxNonProgressMs)),
    completedLogicalGoals:goals.filter(g=>g.outcome==="completed"&&g.arrivalAtMs!==null).length,
    goalHistoryTruncated:metrics.goalHistoryTruncated,
    failedRouteAssignments:routeFailures,pathQueries:metrics.pathQueries,
    recoveryAttempts:metrics.recoveryAttempts,droppedMs:metrics.droppedMs,
    wallTestElapsedMs:Number(wallElapsedMs.toFixed(1)),processHeapDeltaBytes:heapDeltaBytes,
    finalBlocked:metrics.actors.filter(a=>a.status==="blocked"||a.status==="unreachable").map(a=>({id:a.id,reason:a.reason}))};
   console.info("ISO_STRESS_RESULT "+JSON.stringify(summary));
   expect(totalSteps).toBe(ticks);
   expect(collisions).toBe(0);
   expect(invalid).toBe(0);
   expect(teleports).toBe(0);
   expect(longWaiters.size).toBe(0); // the 25s recovery gate, never silently waived
   expect(maxWaiting).toBeLessThan(25_000);
   expect(crowd.valid()).toBe(true);
   expect(arrivals).toBeGreaterThan(0);
   expect(metrics.goalHistoryTruncated).toBe(0);
   expect(goals.every(g=>g.requestAtMs<=metrics.simulatedMs)).toBe(true);
   expect(goals.every(g=>g.outcome!=="completed" ||
    (g.reservationAtMs!==null && g.arrivalAtMs!==null &&
     g.arrivalAtMs>=g.reservationAtMs && g.arrivalAtMs>=g.requestAtMs))).toBe(true);
   expect(goals.every(g=>g.outcome!=="rejected" || g.reason==="destination-reserved")).toBe(true);
   expect(goals.every(g=>g.outcome!=="canceled" || !!g.reason)).toBe(true);
   // A route which is genuinely blocked by another stationary occupant is
   // reported, not classified as a successful arrival or a safety violation.
  }, 180_000);
 }
});

const square = () => worldIsoSealPlan({
 id:"fixed-goal-stress",floor:[{u:0,v:0},{u:20,v:0},{u:20,v:20},{u:0,v:20}],
 colliders:[],anchors:[{id:"door",kind:"door",at:{u:1,v:1},facing:"s"}],door:"door",
})!;

describe("held-goal and adversarial liveness instrumentation",()=>{
 it("completes 15 unchanged goals within a 60-second held window with continuous swept checks",()=>{
  const crowd=new WorldIsoCrowd(square());
  const starts=Array.from({length:15},(_,i)=>({
   id:"actor:"+String(i).padStart(2,"0"),
   at:{u:2+(i%5)*3,v:2+Math.floor(i/5)*4},
  }));
  for(const a of starts){
   expect(crowd.join({id:a.id,kind:"pal",at:a.at})).toBe(true);
   expect(crowd.assign(a.id,{u:a.at.u+1,v:a.at.v})).toBe(true);
  }
  let previous=crowd.snapshot(),sweptViolations=0;
  for(let i=0;i<600;i++){
   crowd.step(100);
   const now=crowd.snapshot();
   expect(crowd.valid()).toBe(true);
   for(let x=0;x<now.length;x++){
    const a=now[x]!,pa=previous[x]!;
    expect(dist(a.at,pa.at)).toBeLessThanOrEqual(.161);
    for(let y=x+1;y<now.length;y++){
     const b=now[y]!,pb=previous[y]!;
     if(worldIsoSegmentDistance(pa.at,a.at,pb.at,b.at)<.6-1e-6)sweptViolations++;
    }
   }
   previous=now;
  }
  const d=crowd.diagnostics();
  const completed=d.goals.filter(g=>g.outcome==="completed");
  const summary={scenario:"15-fixed-goals-60s",goals:d.goals.length,
   completed:completed.length,stalled:d.goals.filter(g=>g.outcome==="stalled").length,
   maxBlockedMs:Math.max(0,...d.goals.map(g=>g.maxContinuousBlockedMs)),
   maxTimeToArrivalMs:Math.max(0,...completed.map(g=>g.arrivalAtMs!-g.requestAtMs)),
   sweptViolations};
  console.info("ISO_HELD_GOALS_RESULT "+JSON.stringify(summary));
  expect(d.goals).toHaveLength(15);
  expect(completed).toHaveLength(15);
  expect(d.goals.every(g=>g.reservationAtMs!==null && g.arrivalAtMs!==null)).toBe(true);
  expect(d.goals.every(g=>g.arrivalAtMs!-g.requestAtMs<25_000)).toBe(true);
  expect(d.actors.every(a=>a.arrived)).toBe(true);
  expect(sweptViolations).toBe(0);
 },30_000);

 it("classifies permanently occupied goals as rejected without false arrival or age reset",()=>{
  const crowd=new WorldIsoCrowd(square());
  expect(crowd.join({id:"owner",kind:"pal",at:{u:8,v:8}})).toBe(true);
  expect(crowd.join({id:"claimant",kind:"visitor",at:{u:2,v:2}})).toBe(true);
  expect(crowd.assign("owner",{u:8,v:8})).toBe(true);
  for(let i=0;i<600;i++){
   if(i%5===0)expect(crowd.assign("claimant",{u:8,v:8})).toBe(false);
   crowd.step(100);
   expect(crowd.valid()).toBe(true);
  }
  const d=crowd.diagnostics(),g=d.goals.find(g=>g.actorId==="claimant")!;
  expect(g.outcome).toBe("rejected");
  expect(g.reason).toBe("destination-reserved");
  expect(g.requestAtMs).toBe(0);
  expect(d.actors.find(a=>a.id==="claimant")).toMatchObject({
   arrived:false,reserved:false,status:"blocked",reason:"destination-reserved",
  });
  expect(d.actors.find(a=>a.id==="claimant")!.goalAgeMs).toBeGreaterThanOrEqual(59_900);
  expect(d.goals.filter(g=>g.actorId==="claimant")).toHaveLength(1);
 });

 it("releases a contested anchor to a different claimant without schedule reset",()=>{
  const crowd=new WorldIsoCrowd(square());
  for(const [id,u] of [["A",2],["B",5],["C",11]] as const)
   expect(crowd.join({id,kind:"pal",at:{u,v:3}})).toBe(true);
  const x={u:8,v:8};
  expect(crowd.assign("A",x)).toBe(true);
  expect(crowd.assign("B",x)).toBe(false);
  expect(crowd.assign("C",x)).toBe(false);
  expect(crowd.assign("A",{u:13,v:13})).toBe(true);
  expect(crowd.assign("B",x)).toBe(false); // retry cooldown is explicit
  for(let i=0;i<21;i++)crowd.step(100);
  expect(crowd.assign("B",x)).toBe(true);
  expect(crowd.assign("C",x)).toBe(false);
  expect(crowd.assign("B",{u:14,v:14})).toBe(true);
  for(let i=0;i<21;i++)crowd.step(100);
  expect(crowd.assign("C",x)).toBe(true);
  const d=crowd.diagnostics();
  expect(d.actors.find(a=>a.id==="C")?.reserved).toBe(true);
  expect(d.actors.find(a=>a.id==="B")?.reserved).toBe(true);
  expect(d.goals.filter(g=>g.outcome==="rejected").length).toBe(0);
  expect(crowd.valid()).toBe(true);
 });

 it("replays full simulation state deterministically through churn, pause, and suspension",()=>{
  const run=()=>{
   const crowd=new WorldIsoCrowd(square());
   for(let i=0;i<9;i++){
    const id="pal:"+i,at={u:2+(i%3)*4,v:2+Math.floor(i/3)*4};
    expect(crowd.join({id,kind:"pal",at})).toBe(true);
    expect(crowd.assign(id,{u:at.u+1,v:at.v+1})).toBe(true);
   }
   for(let tick=0;tick<450;tick++){
    if(tick%40===0){
     const id="visitor:"+Math.floor(tick/40);
     if(tick>0)crowd.leave("visitor:"+(Math.floor(tick/40)-1));
     expect(crowd.join({id,kind:"visitor",at:{u:18,v:2}})).toBe(true);
     crowd.assign(id,{u:18,v:15});
    }
    if(tick%37===0)crowd.step(30_000,true);
    if(tick%71===0)crowd.step(30_000);
    crowd.step(100);
    expect(crowd.valid()).toBe(true);
   }
   return {snapshot:crowd.snapshot(),diagnostics:crowd.diagnostics()};
  };
  const a=run(),b=run();
  expect(a).toEqual(b);
  expect(a.diagnostics.droppedMs).toBeGreaterThan(0);
  expect(a.diagnostics.goals.some(g=>g.outcome==="canceled")).toBe(true);
 },30_000);
});

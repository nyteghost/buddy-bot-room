import { describe, expect, it } from "vitest";
import { WorldIsoCrowd } from "@/lib/world-iso-crowd";
import { WORLD_ISO_GREYBOX } from "@/lib/world-iso-greybox";
import { worldIsoSchedule, WORLD_ISO_PAL_IDS, WORLD_ISO_SCHEDULE_PERIOD_MS } from "@/lib/world-iso-schedule";
import { worldIsoPointFree } from "@/lib/world-iso-ground";

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
     if(actor.status==="unreachable" || actor.status==="blocked") unreachable++;
     if(actor.status==="arrived" && !seenArrivals.has(actor.id+":"+phase)){
      arrivals++;seenArrivals.add(actor.id+":"+phase);
     }
    }
    previous=now;
   }
   const elapsedCpuMs=performance.now()-started;
   const heapDeltaBytes=process.memoryUsage().heapUsed-beforeHeap;
   const metrics=crowd.diagnostics();
   const summary={seed:seeds[seed],simulatedMinutes:20,actors:15,ticks:totalSteps,
    collisions,invalidGroundPositions:invalid,teleportViolations:teleports,
    arrivals,blockedOrUnreachableSamples:unreachable,maxWaitingMs:maxWaiting,
    failedRouteAssignments:routeFailures,pathQueries:metrics.pathQueries,
    recoveryAttempts:metrics.recoveryAttempts,droppedMs:metrics.droppedMs,
    cpuMs:Number(elapsedCpuMs.toFixed(1)),approxHeapDeltaBytes:heapDeltaBytes,
    finalBlocked:metrics.actors.filter(a=>a.status==="blocked"||a.status==="unreachable").map(a=>({id:a.id,reason:a.reason}))};
   console.info("ISO_STRESS_RESULT "+JSON.stringify(summary));
   expect(totalSteps).toBe(ticks);
   expect(collisions).toBe(0);
   expect(invalid).toBe(0);
   expect(teleports).toBe(0);
   expect(crowd.valid()).toBe(true);
   expect(arrivals).toBeGreaterThan(0);
   // A route which is genuinely blocked by another stationary occupant is
   // reported, not classified as a successful arrival or a safety violation.
  }, 180_000);
 }
});

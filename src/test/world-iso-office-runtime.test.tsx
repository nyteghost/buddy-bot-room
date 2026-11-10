// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, render, screen } from "@testing-library/react";
import { WorldIsoOffice } from "@/components/world-iso-office";
import { WorldIsoCrowd } from "@/lib/world-iso-crowd";
import * as isoScene from "@/lib/world-iso-scene";
import { WORLD_ISO_PAL_IDS } from "@/lib/world-iso-schedule";
import type { HdOfficePal } from "@/components/world-hd-office";

vi.mock("@/lib/reduced-motion", () => ({ useReducedMotion: () => false }));
vi.mock("@/lib/power", () => ({ lowPower: { use: () => false }, useTabHidden: () => false }));
const pals = (): HdOfficePal[] => WORLD_ISO_PAL_IDS.map(id => ({id,name:id,enabled:true,real:null}));
let now=1000;
let queue=new Map<number,FrameRequestCallback>(),nextId=1;
const advance=(dt:number)=>{
 now+=dt;
 const due=[...queue.values()];queue.clear();
 act(()=>{for(const frame of due)frame(now);});
};
beforeEach(()=>{
 now=1000;queue=new Map();nextId=1;
 vi.spyOn(performance,"now").mockImplementation(()=>now);
 vi.stubGlobal("requestAnimationFrame",(fn:FrameRequestCallback)=>{
  const id=nextId++;queue.set(id,fn);return id;
 });
 vi.stubGlobal("cancelAnimationFrame",(id:number)=>{queue.delete(id);});
});
afterEach(()=>{vi.restoreAllMocks();vi.unstubAllGlobals();});

describe("Step 1b mounted-only-in-tests runtime contracts",()=>{
 it("keeps the ambient clock and positions through 8-second equivalent parent rerenders",()=>{
  const initial=pals();
  const {rerender,container,unmount}=render(
   <WorldIsoOffice pals={initial} visitors={[]} visible playful paused={false} synthetic />);
  const nova=()=>container.querySelector('[data-iso-actor="pal:nova"] circle')?.getAttribute("cx");
  const origin=nova();
  expect(origin).toBeTruthy();
  // More than one 20s interval. Fresh objects mimic room.tsx every 8s.
  for(let tick=1;tick<=230;tick++){
   if(tick%80===0) rerender(<WorldIsoOffice pals={pals()} visitors={[]} visible playful paused={false} synthetic />);
   advance(100);
  }
  expect(nova()).not.toBe(origin);
  expect(container.querySelector("[data-iso-fallback]")).toBeNull();
  unmount();
  expect(queue.size).toBe(0);
 },30_000);

 it("stops frames while paused and resumes without an elapsed-time jump",()=>{
  const {rerender,container,unmount}=render(
   <WorldIsoOffice pals={pals()} visitors={[]} visible playful paused={false} synthetic />);
  for(let i=0;i<220;i++)advance(100);
  const snapshot=container.querySelector('[data-iso-actor="pal:nova"] circle')?.getAttribute("cx");
  rerender(<WorldIsoOffice pals={pals()} visitors={[]} visible playful paused synthetic />);
  expect(queue.size).toBe(0);
  advance(30_000);
  expect(container.querySelector('[data-iso-actor="pal:nova"] circle')?.getAttribute("cx")).toBe(snapshot);
  rerender(<WorldIsoOffice pals={pals()} visitors={[]} visible playful paused={false} synthetic />);
  advance(100);
  expect(container.querySelector("[data-iso-fallback]")).toBeNull();
  unmount();
 },30_000);

 it("contains asynchronous placement failure and notifies once, without remount loops",()=>{
  const join=vi.spyOn(WorldIsoCrowd.prototype,"join").mockReturnValue(false);
  const onFailure=vi.fn();
  const {rerender,container}=render(<WorldIsoOffice pals={pals()} visitors={[]} visible playful paused={false}
   synthetic onFailure={onFailure}
   fallback={<span data-testid="flat-owner">Flat Office stays outside this preview</span>}/>);
  expect(join).toHaveBeenCalled();
  expect(screen.getByTestId("flat-owner")).toBeTruthy();
  expect(container.querySelector("[data-iso-preview]")).toBeNull();
  expect(onFailure).toHaveBeenCalledTimes(1);
  rerender(<WorldIsoOffice pals={pals()} visitors={[]} visible playful paused={false}
   synthetic onFailure={onFailure}
   fallback={<span data-testid="flat-owner">Flat Office stays outside this preview</span>}/>);
  expect(onFailure).toHaveBeenCalledTimes(1);
  expect(queue.size).toBe(0);
 });

 it("dispatches at most two new route assignments in an animation frame",()=>{
  const assign=vi.spyOn(WorldIsoCrowd.prototype,"assign");
  const {unmount}=render(<WorldIsoOffice pals={pals()} visitors={[]} visible playful paused={false} synthetic />);
  advance(100);
  expect(assign.mock.calls.length).toBeLessThanOrEqual(2);
  for(let i=0;i<5;i++){
   const old=assign.mock.calls.length;
   advance(100);
   expect(assign.mock.calls.length-old).toBeLessThanOrEqual(2);
  }
  expect(assign.mock.calls.length).toBe(9);
  unmount();
 });

 it("contains synchronous render errors and shows the owner-provided flat fallback",()=>{
  const error=vi.spyOn(console,"error").mockImplementation(()=>{});
  const badCamera=Object.defineProperty({}, "zoom", { get(){throw new Error("bad camera");} });
  render(<WorldIsoOffice pals={pals()} visitors={[]} visible playful={false} paused synthetic
   camera={badCamera as {x:number;y:number;zoom:number}}
   fallback={<span data-testid="flat-owner">Flat Office retained</span>}/>);
  expect(screen.getByTestId("flat-owner")).toBeTruthy();
  expect(screen.getByRole("alert")).toBeTruthy();
  error.mockRestore();
 });
 for (const mode of ["returns-null","throws"] as const) {
  it("fail-stops RAF when scene generation "+mode+" and never restarts on parent rerender",()=>{
   const real=isoScene.worldIsoSceneFrame;
   const renderScene=vi.spyOn(isoScene,"worldIsoSceneFrame");
   if(mode==="returns-null")renderScene.mockImplementation(()=>null);
   else renderScene.mockImplementation(()=>{throw new Error("scene failure");});
   const onFailure=vi.fn(),updates=vi.spyOn(WorldIsoCrowd.prototype,"step");
   const owner=<span data-testid="flat-owner">The supplied fallback remains independent</span>;
   const {rerender,unmount,container}=render(<WorldIsoOffice pals={pals()} visitors={[]}
    visible playful paused={false} synthetic onFailure={onFailure} fallback={owner}/>);
   expect(screen.getByTestId("flat-owner")).toBeTruthy();
   expect(container.querySelector("[data-iso-preview]")).toBeNull();
   expect(queue.size).toBe(0);
   expect(onFailure).toHaveBeenCalledTimes(1);
   const sceneCalls=renderScene.mock.calls.length,stepCalls=updates.mock.calls.length;
   for(let i=0;i<10;i++)advance(100);
   rerender(<WorldIsoOffice pals={pals()} visitors={[]} visible playful paused={false}
    synthetic onFailure={onFailure} fallback={owner}/>);
   expect(renderScene).toHaveBeenCalledTimes(sceneCalls);
   expect(updates).toHaveBeenCalledTimes(stepCalls);
   expect(onFailure).toHaveBeenCalledTimes(1);
   expect(queue.size).toBe(0);
   unmount();
   expect(queue.size).toBe(0);
   renderScene.mockRestore();
   expect(real).toBeTruthy();
  });
 }

 it("cancels an already active RAF after a later scene frame becomes null",()=>{
  const real=isoScene.worldIsoSceneFrame;
  const scene=vi.spyOn(isoScene,"worldIsoSceneFrame");
  let calls=0, fail=false;
  scene.mockImplementation((...args)=>{calls++;return fail ? null : real(...args);});
  const onFailure=vi.fn();
  const {rerender,container,unmount}=render(<WorldIsoOffice pals={pals()} visitors={[]}
   visible playful paused={false} synthetic onFailure={onFailure}
   fallback={<span data-testid="fault-owner">Fallback</span>}/>);
  expect(queue.size).toBe(1);
  fail=true;
  advance(100);
  expect(container.querySelector("[data-iso-fallback]")).toBeTruthy();
  expect(queue.size).toBe(0);
  expect(onFailure).toHaveBeenCalledTimes(1);
  const recorded=calls;
  rerender(<WorldIsoOffice pals={pals()} visitors={[]} visible playful paused={false}
   synthetic onFailure={onFailure}/>);
  advance(200);
  expect(calls).toBe(recorded);
  expect(onFailure).toHaveBeenCalledTimes(1);
  expect(queue.size).toBe(0);
  unmount();
 });

});

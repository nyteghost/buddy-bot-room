import { describe, expect, it, vi } from 'vitest';
import { combine, FrameScheduler, intersect, interpolateActor, percentile, PerfMetrics, planDamage, sceneIsSafe, TownSimulation, VisibilityGate } from './core';

describe('deterministic synthetic simulation', () => {
  it('repeats exact paths across two instances', () => { const a=new TownSimulation(32), b=new TownSimulation(32); for(let n=0;n<1200;n++){a.step(33);b.step(33);} expect(a.snapshot()).toEqual(b.snapshot()); });
  it('supports 0, 1, and 128 unique Pals', () => { for(const count of [0,1,32,128]) { const s=new TownSimulation(count).snapshot(); expect(s.actors).toHaveLength(count); expect(new Set(s.actors.map(a=>a.id)).size).toBe(count); expect(sceneIsSafe(s)).toBe(true); } });
  it('rejects excessive actors and invalid deltas', () => { expect(()=>new TownSimulation(129)).toThrow(); expect(()=>new TownSimulation(-1)).toThrow(); const s=new TownSimulation(); expect(()=>s.step(NaN)).toThrow(); expect(()=>s.step(-1)).toThrow(); });
  it('clamps animation delta after a long pause', () => { const a=new TownSimulation(), b=new TownSimulation(); a.step(999999); b.step(100); expect(a.snapshot()).toEqual(b.snapshot()); });
  it('interpolates world position and stride without changing actor identity', () => { const [a,b]=[new TownSimulation(1).snapshot().actors[0],new TownSimulation(1).snapshot().actors[0]]; const target={...b,x:b.x+2,y:b.y+4,stride:10}; expect(interpolateActor(a,target,.5).x).toBeCloseTo(a.x+1); expect(interpolateActor(a,target,.5).y).toBeCloseTo(a.y+2); expect(interpolateActor(a,target,3).x).toBe(target.x); expect(()=>interpolateActor(a,{...target,id:'other'},.5)).toThrow(); });
  it('allows deterministic authoritative time seek without renderer stepping', () => {
    const a=new TownSimulation(4), b=new TownSimulation(4);
    a.seek(90234); b.seek(90234);
    expect(a.snapshot()).toEqual(b.snapshot());
    expect(()=>a.seek(-1)).toThrow();
    expect(()=>a.seek(NaN)).toThrow();
  });
  it('rejects invalid/duplicate/NaN scenes instead of drawing indefinitely', () => { const s=new TownSimulation().snapshot(); expect(sceneIsSafe({...s,actors:[s.actors[0],s.actors[0]]})).toBe(false); expect(sceneIsSafe({...s,actors:[{...s.actors[0],x:Infinity}]})).toBe(false); expect(sceneIsSafe({...s,tiles:[{x:NaN,y:0,kind:'grass'}]})).toBe(false); });
});
describe('dirty damage and scene invalidation', () => {
  const bounds={x:0,y:0,w:400,h:300};
  it('combines overlapping motion damage', () => expect(planDamage([{x:4,y:4,w:12,h:12}],[{x:10,y:10,w:14,h:14}],bounds)).toEqual([{x:4,y:4,w:20,h:20}]));
  it('keeps separated Pals in separate damage rectangles', () => expect(planDamage([{x:1,y:1,w:10,h:10}],[{x:250,y:150,w:10,h:10}],bounds)).toHaveLength(2));
  it('escalates to full clear when too much area changed', () => expect(planDamage([{x:0,y:0,w:350,h:250}],[],bounds)).toEqual([bounds]));
  it('force-full and invalid rectangles cannot leave stale pixels', () => { expect(planDamage([],[],bounds,true)).toEqual([bounds]); expect(planDamage([{x:NaN,y:0,w:2,h:2}],[],bounds)).toEqual([bounds]); });
  it('ignores empty changes, clips off-screen changes', () => { expect(planDamage([],[],bounds)).toEqual([]); expect(planDamage([{x:-100,y:-100,w:3,h:3}],[],bounds)).toEqual([]); });
  it('preserves previous rectangle overlap math', () => { expect(intersect({x:0,y:0,w:10,h:10},{x:9,y:9,w:3,h:3})).toBe(true); expect(combine({x:0,y:0,w:5,h:5},{x:4,y:4,w:6,h:6})).toEqual({x:0,y:0,w:10,h:10}); });
});
describe('idle-safe scheduler, visibility and metrics', () => {
  function fake() { let n=0; const q = new Map<number,FrameRequestCallback>(); const request=vi.fn((cb:FrameRequestCallback)=>{q.set(++n,cb);return n;});const cancel=vi.fn((id:number)=>{q.delete(id);});const tick=(time:number)=>{const [id,cb]=[...q][0]??[];if(cb){q.delete(id);cb(time)}};return {q,request,cancel,tick};}
  it('has no idle RAF and does not schedule duplicate loops', () => { const f=fake(),render=vi.fn(()=>1),s=new FrameScheduler(f.request,f.cancel,render);expect(f.q.size).toBe(0);s.start();s.start();expect(f.q.size).toBe(1);f.tick(0);f.tick(17);expect(render).toHaveBeenCalledTimes(1);s.stop();expect(f.q.size).toBe(0);f.tick(50);expect(render).toHaveBeenCalledTimes(1); });
  it('resumes visible content only when user still wants walking', () => { const f=fake(),s=new FrameScheduler(f.request,f.cancel,()=>1),gate=new VisibilityGate(s);gate.setWanted(true);expect(f.q.size).toBe(1);gate.setVisible(false);expect(f.q.size).toBe(0);gate.setVisible(true);expect(f.q.size).toBe(1);gate.setWanted(false);expect(f.q.size).toBe(0);gate.setVisible(false);gate.setVisible(true);expect(f.q.size).toBe(0); });
  it('drops to 30fps on expensive frames and stops cleanly', () => { const f=fake(),s=new FrameScheduler(f.request,f.cancel,()=>23);s.start();f.tick(0);for(let i=1;i<=6;i++)f.tick(i*50);expect(s.targetFps).toBe(30);s.stop();expect(f.q.size).toBe(0); });
  it('recovers from 30 to 60fps after sustained cheap frames', () => {
    const f=fake(); let cost=23; const s=new FrameScheduler(f.request,f.cancel,()=>cost);
    s.start(); f.tick(0);
    for(let i=1;i<=6;i++) f.tick(i*50);
    expect(s.targetFps).toBe(30);
    cost=1;
    for(let i=1;i<=122;i++) f.tick(300+i*34);
    expect(s.targetFps).toBe(60);
    s.stop();
  });
  it('clamps huge frame-time before updating authoritative simulation', () => { const f=fake(),times:number[]=[],s=new FrameScheduler(f.request,f.cancel,(dt)=>{times.push(dt);return 1;});s.start();f.tick(0);f.tick(4000);expect(times).toEqual([100]);s.stop(); });
  it('retains bounded metrics and returns a window p95',()=>{const p=new PerfMetrics();for(let i=0;i<5000;i++)p.record(i*33,2);expect(p.snapshot().frames).toBe(5000);expect(p.snapshot().p95FrameIntervalMs).toBe(33);expect(p.snapshot().fps).toBeCloseTo(1000/33,3);p.reset();expect(p.snapshot().frames).toBe(0);expect(percentile([1,2,3,4,5],.95)).toBe(5);});
});

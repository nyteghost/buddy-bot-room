#!/usr/bin/env node
// Offline deterministic regression suite. Uses Node >=22.6 --experimental-strip-types.
// Independent of npm packages, rendering backend, Linux GUI or production project.
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { combine, FrameScheduler, intersect, interpolateActor, PerfMetrics, planDamage, sceneIsSafe, TownSimulation, VisibilityGate } from '../src/core.ts';
test('stable scene, 128 actors and repeatable time paths', () => {
  const a=new TownSimulation(128), b=new TownSimulation(128);
  for (let i=0;i<1000;i++) { a.step(33); b.step(33); }
  assert.deepEqual(a.snapshot(),b.snapshot());
  assert.equal(new Set(a.snapshot().actors.map(x=>x.id)).size,128);
  assert.equal(sceneIsSafe(a.snapshot()),true);
});
test('empty and invalid scenes, count bounds, clock clamp', () => {
  assert.equal(new TownSimulation(0).snapshot().actors.length,0);
  assert.throws(()=>new TownSimulation(129),RangeError);
  assert.throws(()=>new TownSimulation(-1),RangeError);
  const a=new TownSimulation(), b=new TownSimulation();a.step(100000);b.step(100);
  assert.deepEqual(a.snapshot(),b.snapshot());
  assert.throws(()=>a.step(-1),RangeError);
  assert.throws(()=>a.step(NaN),RangeError);
  const s=a.snapshot();
  assert.equal(sceneIsSafe({...s,actors:[s.actors[0],s.actors[0]]}),false);
  assert.equal(sceneIsSafe({...s,actors:[{...s.actors[0],x:Infinity}]}),false);
});
test('absolute synthetic time stays deterministic after renderer suspension',()=>{
  const a=new TownSimulation(4),b=new TownSimulation(4);a.seek(90123);b.seek(90123);
  assert.deepEqual(a.snapshot(),b.snapshot());assert.throws(()=>a.seek(-1),RangeError);
});
test('interpolation stays in range and maintains actor identity', () => {
  const a=new TownSimulation().snapshot().actors[0], b={...a,x:a.x+2,y:a.y+4,stride:a.stride+10};
  assert.equal(interpolateActor(a,b,.5).x,a.x+1);
  assert.equal(interpolateActor(a,b,.5).y,a.y+2);
  assert.equal(interpolateActor(a,b,5).x,b.x);
  assert.throws(()=>interpolateActor(a,{...b,id:'other'},.5),RangeError);
});
test('damage union/clip/segmentation and alpha-safe fallback', () => {
  const bounds={x:0,y:0,w:400,h:300};
  assert.deepEqual(planDamage([],[],bounds),[]);
  assert.deepEqual(planDamage([{x:4,y:4,w:12,h:12}],[{x:10,y:10,w:14,h:14}],bounds),[{x:4,y:4,w:20,h:20}]);
  assert.equal(planDamage([{x:1,y:1,w:10,h:10}],[{x:250,y:150,w:10,h:10}],bounds).length,2);
  assert.deepEqual(planDamage([{x:0,y:0,w:350,h:250}],[],bounds),[bounds]);
  assert.deepEqual(planDamage([{x:NaN,y:0,w:2,h:2}],[],bounds),[bounds]);
  assert.deepEqual(planDamage([{x:-99,y:-99,w:2,h:2}],[],bounds),[]);
  assert.equal(intersect({x:0,y:0,w:10,h:10},{x:9,y:9,w:2,h:2}),true);
  assert.deepEqual(combine({x:0,y:0,w:5,h:5},{x:4,y:4,w:6,h:6}),{x:0,y:0,w:10,h:10});
});
function fakeFrames() {
  let next=0; const callbacks=new Map();
  return {callbacks,request(cb){callbacks.set(++next,cb);return next;},cancel(id){callbacks.delete(id);},flush(t){const [id,cb]=callbacks.entries().next().value??[];if(cb){callbacks.delete(id);cb(t);}}};
}
test('no idle RAF; start/stop idempotent; no loop after stop', () => {
  const f=fakeFrames();let renders=0;const s=new FrameScheduler(cb=>f.request(cb),id=>f.cancel(id),()=>{renders++;return 1;});
  assert.equal(f.callbacks.size,0);s.start();s.start();assert.equal(f.callbacks.size,1);f.flush(0);f.flush(17);assert.equal(renders,1);
  s.stop();s.stop();assert.equal(f.callbacks.size,0);f.flush(50);assert.equal(renders,1);
});
test('visibility hides renderer and resumes previous intent, not after user pause',()=>{
  const f=fakeFrames(),s=new FrameScheduler(cb=>f.request(cb),id=>f.cancel(id),()=>1),gate=new VisibilityGate(s);
  gate.setWanted(true);assert.equal(f.callbacks.size,1);
  gate.setVisible(false);assert.equal(f.callbacks.size,0);
  gate.setVisible(true);assert.equal(f.callbacks.size,1);
  gate.setWanted(false);gate.setVisible(false);gate.setVisible(true);assert.equal(f.callbacks.size,0);
});
test('frame duration capped to 100ms, sustained slowness drops to 30fps',()=>{
  const f=fakeFrames(),deltas=[],s=new FrameScheduler(cb=>f.request(cb),id=>f.cancel(id),(dt)=>{deltas.push(dt);return 23;});
  s.start();f.flush(0);for(let i=1;i<=6;i++)f.flush(i*2000);
  assert.equal(s.targetFps,30);assert.ok(deltas.every(x=>x===100));s.stop();
});
test('bounded 30-minute timing window, stable total FPS',()=>{
  const p=new PerfMetrics();for(let i=0;i<110000;i++)p.record(i*33,2);
  const s=p.snapshot();assert.equal(s.frames,110000);assert.equal(s.p95FrameIntervalMs,33);assert.ok(Math.abs(s.fps-1000/33)<.001);
  p.reset();assert.equal(p.snapshot().frames,0);
});

import { describe, expect, it, vi } from 'vitest';
import { combine, FrameScheduler, intersect, percentile, PerfMetrics, TownSimulation } from './core';
describe('renderer-neutral town simulation', () => {
  it('is deterministic and has no dependency on a window or renderer', () => { const a = new TownSimulation(), b = new TownSimulation(); for (let n = 0; n < 600; n++) { a.step(33); b.step(33) } expect(a.snapshot()).toEqual(b.snapshot()); expect(a.snapshot().actors).toHaveLength(1) });
  it('rejects invalid deltas and clamps long sleep intervals', () => { const scene = new TownSimulation(); expect(() => scene.step(-1)).toThrow(); expect(() => scene.step(Number.NaN)).toThrow(); scene.step(99999); expect(scene.snapshot().actors[0].x).toBeLessThan(5.6) });
  it('computes dirty bounds without excluding overlaps', () => { expect(intersect({x:0,y:0,w:10,h:10},{x:9,y:9,w:2,h:2})).toBe(true); expect(intersect({x:0,y:0,w:10,h:10},{x:10,y:1,w:2,h:2})).toBe(false); expect(combine({x:0,y:0,w:5,h:5},{x:4,y:4,w:6,h:6})).toEqual({x:0,y:0,w:10,h:10}) });
  it('calculates nearest-rank percentiles and frame intervals', () => { expect(percentile([1,5,3,2,4],.95)).toBe(5); const m = new PerfMetrics(); m.record(100,2); m.record(133,4); expect(m.snapshot().p95FrameIntervalMs).toBe(33); expect(m.snapshot().frames).toBe(2); m.reset(); expect(m.snapshot().frames).toBe(0) });
});
describe('adaptive idle-free scheduler', () => {
  function fake() { let next = 1; const callbacks = new Map<number,FrameRequestCallback>(); const cancel = vi.fn((id:number)=>{callbacks.delete(id)}); const request = vi.fn((cb:FrameRequestCallback)=>{const id=next++;callbacks.set(id,cb);return id}); const flush=(time:number)=>{const [id,cb] = [...callbacks][0] ?? []; if(cb){callbacks.delete(id);cb(time)}}; return {callbacks,cancel,request,flush} }
  it('never queues while idle, cancels on stop, and does not duplicate requests', () => { const f=fake(), render=vi.fn(()=>1), s = new FrameScheduler(f.request,f.cancel,render); expect(f.callbacks.size).toBe(0); s.start(); s.start(); expect(f.callbacks.size).toBe(1); f.flush(100); f.flush(117); expect(render).toHaveBeenCalledTimes(1); s.stop(); expect(f.callbacks.size).toBe(0); expect(s.running).toBe(false); f.flush(150); expect(render).toHaveBeenCalledTimes(1) });
  it('drops to 30fps after sustained expensive frames', () => { const f=fake(), s = new FrameScheduler(f.request,f.cancel,()=>23); s.start(); f.flush(0); for(let n=1;n<=6;n++) f.flush(n*50); expect(s.targetFps).toBe(30); s.stop() });
});

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { TownSimulation } from './core';
import { CanvasTownRenderer } from './renderer';
type Fake = { width: number; height: number; getContext: (kind: string, options?: object) => CanvasRenderingContext2D | null };
function mockContext() {
  const calls: string[] = [];
  const target: Record<string, unknown> = {};
  const ctx = new Proxy(target, {
    get(object, key) {
      if (typeof key !== 'string') return undefined;
      if (!(key in object)) object[key] = (...args: unknown[]) => { calls.push(key); return undefined; };
      return object[key];
    },
    set(object, key, value) { object[String(key)] = value; return true; }
  });
  return { ctx: ctx as unknown as CanvasRenderingContext2D, calls };
}
describe('Canvas damage, cache and lifetime using deterministic fake contexts', () => {
  let contexts: ReturnType<typeof mockContext>[], canvas: Fake;
  beforeEach(() => {
    contexts = [];
    function fakeCanvas(): Fake {
      const data = mockContext(); contexts.push(data);
      return { width: 0, height: 0, getContext: () => data.ctx };
    }
    canvas = fakeCanvas();
    vi.stubGlobal('document', { createElement: () => fakeCanvas() });
  });
  afterEach(() => vi.unstubAllGlobals());
  it('draws initial scene, then skips unchanged revision without repeating drawImage', () => {
    const renderer = new CanvasTownRenderer(canvas as unknown as HTMLCanvasElement);
    renderer.resize(800, 600, 1.5);
    const scene = new TownSimulation(5).snapshot();
    expect(renderer.render(scene)).toBe(true);
    const before = contexts[0].calls.filter(x => x === 'drawImage').length;
    expect(renderer.render(scene)).toBe(false);
    expect(contexts[0].calls.filter(x => x === 'drawImage')).toHaveLength(before);
    expect(canvas.width).toBe(1200);
    renderer.dispose();
  });
  it('redraws moving Pal and previous damage but handles empty scene', () => {
    const renderer = new CanvasTownRenderer(canvas as unknown as HTMLCanvasElement);
    renderer.resize(480, 300, 1);
    const world = new TownSimulation(8);
    expect(renderer.render(world.snapshot())).toBe(true);
    world.step(33);
    expect(renderer.render(world.snapshot())).toBe(true);
    const empty=new TownSimulation(0).snapshot();
    expect(renderer.render({...empty,revision:100})).toBe(true);
    renderer.dispose();
  });
  it('invalid scene fails closed without throwing or leaving stale pixels', () => {
    const renderer = new CanvasTownRenderer(canvas as unknown as HTMLCanvasElement);
    renderer.resize(500, 450, 1);
    const scene = new TownSimulation(1).snapshot();
    expect(renderer.render(scene)).toBe(true);
    expect(renderer.render({...scene,revision:2,actors:[{...scene.actors[0],x:NaN}]})).toBe(false);
    expect(contexts[0].calls).toContain('clearRect');
    renderer.dispose();
  });
  it('static geometry revision forces redraw even if actor revision is unchanged', () => {
    const renderer = new CanvasTownRenderer(canvas as unknown as HTMLCanvasElement);
    renderer.resize(450, 350, 1);
    const scene = new TownSimulation(0).snapshot();
    expect(renderer.render(scene)).toBe(true);
    expect(renderer.render(scene)).toBe(false);
    expect(renderer.render({...scene,staticRevision:1})).toBe(true);
    renderer.dispose();
  });
  it('safe disposal is idempotent and fresh instance can restart', () => {
    const r1 = new CanvasTownRenderer(canvas as unknown as HTMLCanvasElement);
    r1.resize(100, 100, 2); r1.dispose();r1.dispose();
    expect(r1.render(new TownSimulation().snapshot())).toBe(false);
    const r2 = new CanvasTownRenderer(canvas as unknown as HTMLCanvasElement);
    r2.resize(120, 100, 1);expect(r2.render(new TownSimulation().snapshot())).toBe(true);r2.dispose();
  });
});

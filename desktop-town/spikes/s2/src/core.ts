/** Renderer-independent, deterministic S2 scene/simulation contract. */
export interface Point { readonly x: number; readonly y: number }
export interface Rect { readonly x: number; readonly y: number; readonly w: number; readonly h: number }
export interface Tile { readonly x: number; readonly y: number; readonly kind: 'grass' | 'path' }
export interface Building { readonly x: number; readonly y: number; readonly kind: 'post' | 'cafe' }
export interface Actor { readonly id: string; readonly x: number; readonly y: number; readonly facing: -1 | 1; readonly stride: number; readonly color: string }
export interface Scene { readonly revision: number; readonly tiles: readonly Tile[]; readonly buildings: readonly Building[]; readonly actors: readonly Actor[] }
export interface SceneRenderer { render(scene: Scene, full?: boolean): void; resize(width: number, height: number, pixelRatio: number): void; dispose(): void }
export function intersect(a: Rect, b: Rect): boolean { return a.x < b.x + b.w && a.x + a.w > b.x && a.y < b.y + b.h && a.y + a.h > b.y }
export function combine(a: Rect, b: Rect): Rect { const x = Math.min(a.x, b.x), y = Math.min(a.y, b.y); return { x, y, w: Math.max(a.x + a.w, b.x + b.w) - x, h: Math.max(a.y + a.h, b.y + b.h) - y } }
export function percentile(values: readonly number[], p: number): number { if (!values.length) return 0; const sorted = [...values].sort((a, b) => a - b); return sorted[Math.min(sorted.length - 1, Math.max(0, Math.ceil(p * sorted.length) - 1))] }
export class TownSimulation {
  private x = 1.7; private direction: -1 | 1 = 1; private elapsed = 0; private revision = 0;
  private readonly tiles: readonly Tile[]; private readonly buildings: readonly Building[] = [{ x: 1.5, y: 0.3, kind: 'post' }, { x: 4.2, y: 0.4, kind: 'cafe' }];
  constructor() { const tiles: Tile[] = []; for (let y = 0; y < 8; y++) for (let x = 0; x < 8; x++) tiles.push({ x, y, kind: y === 4 || x === 3 ? 'path' : 'grass' }); this.tiles = tiles }
  step(dtMs: number): void {
    if (!Number.isFinite(dtMs) || dtMs < 0) throw new RangeError('invalid frame delta');
    const dt = Math.min(dtMs, 100) / 1000; this.elapsed += dt;
    let distance = dt * 1.25;
    while (distance > 0) { const remaining = this.direction > 0 ? 5.5 - this.x : this.x - 1.5; const advance = Math.min(distance, Math.max(0, remaining)); this.x += this.direction * advance; distance -= advance; if (remaining <= advance + 1e-9) this.direction = this.direction === 1 ? -1 : 1; else break }
    this.revision++;
  }
  snapshot(): Scene { return { revision: this.revision, tiles: this.tiles, buildings: this.buildings, actors: [{ id: 'pal-s2', x: this.x, y: 4.3, facing: this.direction, stride: this.elapsed * 10, color: '#ec8cae' }] } }
}
/** Requests frames only while active. It does not schedule any background idle heartbeat. */
export class FrameScheduler {
  private handle: number | null = null; private active = false; private last: number | null = null;
  private interval = 1000 / 60; private slow = 0; private fast = 0;
  constructor(private readonly raf: (fn: FrameRequestCallback) => number, private readonly cancel: (id: number) => void, private readonly render: (dt: number, timestamp: number) => number) {}
  start(): void { if (this.active) return; this.active = true; this.last = null; this.queue() }
  stop(): void { this.active = false; this.last = null; if (this.handle !== null) { this.cancel(this.handle); this.handle = null } }
  get running(): boolean { return this.active }
  get targetFps(): number { return Math.round(1000 / this.interval) }
  private queue(): void { if (this.active && this.handle === null) this.handle = this.raf(t => this.tick(t)) }
  private tick(t: number): void {
    this.handle = null;
    if (!this.active) return;
    if (this.last === null) { this.last = t; this.queue(); return }
    const dt = t - this.last;
    if (dt >= this.interval - 1) {
      this.last = t;
      const cost = this.render(Math.min(100, Math.max(0, dt)), t);
      if (cost > 20 || dt > 42) { this.slow++; this.fast = 0 } else if (cost < 10 && dt < 24) { this.fast++; this.slow = 0 } else { this.slow = 0; this.fast = 0 }
      if (this.slow >= 5) { this.interval = 1000 / 30; this.slow = 0 }
      if (this.fast >= 120) { this.interval = 1000 / 60; this.fast = 0 }
    }
    this.queue();
  }
}
export interface PerfSnapshot { frames: number; fps: number; p95FrameIntervalMs: number; p95DrawMs: number; maxDrawMs: number; idleRafRequests: number }
export class PerfMetrics {
  private frameTimes: number[] = []; private drawTimes: number[] = []; private first = 0; private last = 0; private lastRecorded: number | null = null;
  private draws = 0;
  record(t: number, drawCost: number): void { if (!this.draws) this.first = t; if (this.lastRecorded !== null) this.frameTimes.push(t - this.lastRecorded); this.lastRecorded = t; this.last = t; this.drawTimes.push(drawCost); this.draws++ }
  snapshot(idleRafRequests = 0): PerfSnapshot { return { frames: this.draws, fps: this.draws > 1 && this.last > this.first ? (this.draws - 1) * 1000 / (this.last - this.first) : 0, p95FrameIntervalMs: percentile(this.frameTimes, .95), p95DrawMs: percentile(this.drawTimes, .95), maxDrawMs: Math.max(0, ...this.drawTimes), idleRafRequests } }
  reset(): void { this.frameTimes = []; this.drawTimes = []; this.draws = 0; this.first = this.last = 0; this.lastRecorded = null }
}

/** Phase-0 synthetic scene contract. The renderer MUST NOT own the authoritative world. */
export interface Point { readonly x: number; readonly y: number }
export interface Rect { readonly x: number; readonly y: number; readonly w: number; readonly h: number }
export interface Tile { readonly x: number; readonly y: number; readonly kind: 'grass' | 'path' }
export interface Building { readonly x: number; readonly y: number; readonly kind: 'post' | 'cafe' }
export interface Actor { readonly id: string; readonly x: number; readonly y: number; readonly facing: -1 | 1; readonly stride: number; readonly color: string }
export interface Scene { readonly revision: number; readonly staticRevision: number; readonly tiles: readonly Tile[]; readonly buildings: readonly Building[]; readonly actors: readonly Actor[] }
export interface SceneRenderer { render(scene: Scene, full?: boolean): boolean; resize(width: number, height: number, pixelRatio: number): void; dispose(): void }
export function validRect(r: Rect): boolean { return [r.x, r.y, r.w, r.h].every(Number.isFinite) && r.w > 0 && r.h > 0 }
export function intersect(a: Rect, b: Rect): boolean { return a.x < b.x + b.w && a.x + a.w > b.x && a.y < b.y + b.h && a.y + a.h > b.y }
export function combine(a: Rect, b: Rect): Rect { const x = Math.min(a.x, b.x), y = Math.min(a.y, b.y); return { x, y, w: Math.max(a.x + a.w, b.x + b.w) - x, h: Math.max(a.y + a.h, b.y + b.h) - y } }
export function percentile(values: readonly number[], p: number): number { if (!values.length) return 0; const sorted = [...values].sort((a, b) => a - b); return sorted[Math.min(sorted.length - 1, Math.max(0, Math.ceil(p * sorted.length) - 1))] }
export function sceneIsSafe(scene: Scene): boolean {
  if (!scene || !Array.isArray(scene.actors) || !Array.isArray(scene.tiles) || !Array.isArray(scene.buildings) || !Number.isSafeInteger(scene.revision) || !Number.isSafeInteger(scene.staticRevision) || scene.actors.length > 128 || scene.tiles.length > 4096 || scene.buildings.length > 128) return false;
  const ids = new Set<string>();
  for (const a of scene.actors) {
    if (!a.id || ids.has(a.id) || ![a.x, a.y, a.stride].every(v => Number.isFinite(v) && Math.abs(v) < 100000) || (a.facing !== 1 && a.facing !== -1) || !/^#[0-9a-fA-F]{6}$/.test(a.color)) return false;
    ids.add(a.id);
  }
  for (const p of [...scene.tiles, ...scene.buildings]) if (![p.x, p.y].every(v => Number.isFinite(v) && Math.abs(v) < 100000)) return false;
  return true;
}
/** Damage-plan implementation is pure so both Canvas and future wgpu implementations can test it. */
export function planDamage(previous: readonly Rect[], current: readonly Rect[], viewport: Rect, forceFull = false): Rect[] {
  if (!validRect(viewport)) return [];
  if (forceFull) return [viewport];
  const damage: Rect[] = [];
  for (const r of [...previous, ...current]) {
    if (!validRect(r)) return [viewport]; // fail closed rather than leave visible artifacts
    const x = Math.max(r.x, viewport.x), y = Math.max(r.y, viewport.y);
    const right = Math.min(r.x + r.w, viewport.x + viewport.w), bottom = Math.min(r.y + r.h, viewport.y + viewport.h);
    if (right <= x || bottom <= y) continue;
    let merged: Rect = { x, y, w: right - x, h: bottom - y };
    for (let i = 0; i < damage.length;) {
      const candidate = damage[i];
      if (intersect(merged, candidate)) { merged = combine(merged, candidate); damage.splice(i, 1); i = 0; }
      else i++;
    }
    damage.push(merged);
    if (damage.length > 32) return [viewport];
  }
  const total = damage.reduce((sum, r) => sum + r.w * r.h, 0);
  return total > viewport.w * viewport.h * .65 ? [viewport] : damage;
}
export function interpolateActor(a: Actor, b: Actor, alpha: number): Actor {
  if (a.id !== b.id || !Number.isFinite(alpha)) throw new RangeError('invalid interpolation');
  const t = Math.max(0, Math.min(1, alpha));
  return { ...b, x: a.x + (b.x - a.x) * t, y: a.y + (b.y - a.y) * t, stride: a.stride + (b.stride - a.stride) * t };
}
/** Fixed synthetic lanes, deliberately not a real collision/pathfinding engine. */
export class TownSimulation {
  private elapsed = 0; private revision = 0;
  readonly count: number;
  private readonly tiles: readonly Tile[]; private readonly buildings: readonly Building[] = [{ x: 1.5, y: 3.6, kind: 'post' }, { x: 4.2, y: 0.4, kind: 'cafe' }];
  constructor(count = 1) {
    if (!Number.isSafeInteger(count) || count < 0 || count > 128) throw new RangeError('actor count must be 0..128');
    this.count = count;
    const tiles: Tile[] = []; for (let y = 0; y < 8; y++) for (let x = 0; x < 8; x++) tiles.push({ x, y, kind: y === 4 || x === 3 ? 'path' : 'grass' }); this.tiles = tiles;
  }
  step(dtMs: number): void {
    if (!Number.isFinite(dtMs) || dtMs < 0) throw new RangeError('invalid frame delta');
    this.elapsed += Math.min(dtMs, 100) / 1000; this.revision++;
  }
  /** Absolute-time scene progression, independent of whether any renderer is running. */
  seek(elapsedMs: number): void {
    if (!Number.isFinite(elapsedMs) || elapsedMs < 0) throw new RangeError('invalid scene time');
    const seconds = elapsedMs / 1000;
    if (seconds !== this.elapsed) { this.elapsed = seconds; this.revision++; }
  }
  snapshot(): Scene {
    const actors: Actor[] = [];
    const palette = ['#ec8cae', '#81c2f1', '#f1c482', '#a1dd9f', '#b2a3f0', '#edaa79'];
    for (let i = 0; i < this.count; i++) {
      const phase = (this.elapsed * (1 + (i % 3) * .13) + i * .91) * .34;
      const cycle = ((phase % 2) + 2) % 2;
      const position = cycle < 1 ? cycle : 2 - cycle;
      actors.push({ id: `pal-${i}`, x: 1.2 + 5.9 * position, y: 3.4 + (i % 6) * .62, facing: cycle < 1 ? 1 : -1, stride: this.elapsed * 10 + i, color: palette[i % palette.length] });
    }
    return { revision: this.revision, staticRevision: 0, tiles: this.tiles, buildings: this.buildings, actors };
  }
}
export class FrameScheduler {
  private handle: number | null = null; private active = false; private last: number | null = null;
  private interval = 1000 / 60; private slow = 0; private fast = 0;
  private readonly raf: (fn: FrameRequestCallback) => number;
  private readonly cancel: (id: number) => void;
  private readonly render: (dt: number, timestamp: number) => number;
  constructor(raf: (fn: FrameRequestCallback) => number, cancel: (id: number) => void, render: (dt: number, timestamp: number) => number) { this.raf = raf; this.cancel = cancel; this.render = render; }
  start(): void { if (this.active) return; this.active = true; this.last = null; this.queue(); }
  stop(): void { this.active = false; this.last = null; if (this.handle !== null) { this.cancel(this.handle); this.handle = null; } }
  get running(): boolean { return this.active }
  get targetFps(): number { return Math.round(1000 / this.interval) }
  private queue(): void { if (this.active && this.handle === null) this.handle = this.raf(t => this.tick(t)); }
  private tick(t: number): void {
    this.handle = null;
    if (!this.active) return;
    if (this.last === null) { this.last = t; this.queue(); return; }
    const dt = t - this.last;
    if (Number.isFinite(dt) && dt >= this.interval - 1) {
      this.last = t;
      const cost = this.render(Math.min(100, Math.max(0, dt)), t);
      if (cost > 20 || dt > 42) { this.slow++; this.fast = 0; }
      else if (cost < 10 && dt < (this.interval > 30 ? 40 : 24)) { this.fast++; this.slow = 0; }
      else { this.slow = 0; this.fast = 0; }
      if (this.slow >= 5) { this.interval = 1000 / 30; this.slow = 0; }
      if (this.fast >= 120) { this.interval = 1000 / 60; this.fast = 0; }
    }
    this.queue();
  }
}
/** Visibility pauses rendering, but retains user intent so a resumed tab may redraw. */
export class VisibilityGate {
  private wanted = false; private visible = true;
  private readonly scheduler: Pick<FrameScheduler, 'start' | 'stop'>;
  constructor(scheduler: Pick<FrameScheduler, 'start' | 'stop'>) { this.scheduler = scheduler; }
  setWanted(walk: boolean): void { this.wanted = walk; this.sync(); }
  setVisible(visible: boolean): void { this.visible = visible; this.sync(); }
  get wantsWalking(): boolean { return this.wanted }
  private sync(): void { if (this.wanted && this.visible) this.scheduler.start(); else this.scheduler.stop(); }
}
export interface PerfSnapshot { frames: number; fps: number; p95FrameIntervalMs: number; p95DrawMs: number; maxDrawMs: number; idleRafRequests: number }
/** Windowed p95 over last 4096 samples; bounded memory in 30-minute soak. */
export class PerfMetrics {
  private static readonly capacity = 4096;
  private readonly frameTimes = new Float64Array(4096);
  private readonly drawTimes = new Float64Array(4096);
  private intervals = 0; private draws = 0;
  private first = 0; private last = 0; private lastRecorded: number | null = null;
  record(t: number, drawCost: number): void {
    if (!Number.isFinite(t) || !Number.isFinite(drawCost) || drawCost < 0) return;
    if (!this.draws) this.first = t;
    if (this.lastRecorded !== null) {
      this.frameTimes[this.intervals % PerfMetrics.capacity] = Math.max(0, t - this.lastRecorded);
      this.intervals++;
    }
    this.lastRecorded = t; this.last = t;
    this.drawTimes[this.draws % PerfMetrics.capacity] = drawCost;
    this.draws++;
  }
  snapshot(idleRafRequests = 0): PerfSnapshot {
    const frameWindow = Array.from(this.frameTimes.subarray(0, Math.min(this.intervals, PerfMetrics.capacity)));
    const drawWindow = Array.from(this.drawTimes.subarray(0, Math.min(this.draws, PerfMetrics.capacity)));
    return {
      frames: this.draws,
      fps: this.draws > 1 && this.last > this.first ? (this.draws - 1) * 1000 / (this.last - this.first) : 0,
      p95FrameIntervalMs: percentile(frameWindow, .95),
      p95DrawMs: percentile(drawWindow, .95),
      maxDrawMs: drawWindow.reduce((max, x) => Math.max(max, x), 0),
      idleRafRequests
    };
  }
  reset(): void {
    this.intervals = this.draws = 0;
    this.first = this.last = 0; this.lastRecorded = null;
  }
}

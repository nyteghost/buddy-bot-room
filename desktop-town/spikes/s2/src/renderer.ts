import { intersect, planDamage, sceneIsSafe, type Actor, type Rect, type Scene, type SceneRenderer, type Building } from './core';
type Item = { depth: number; kind: 'actor'; actor: Actor; bounds: Rect } | { depth: number; kind: 'building'; building: Building; bounds: Rect };
/** Transparent Canvas painter. The scene/simulation is an input, never owned by Canvas. */
export class CanvasTownRenderer implements SceneRenderer {
  private readonly ctx: CanvasRenderingContext2D;
  private readonly cache: HTMLCanvasElement;
  private width = 1; private height = 1; private ratio = 1;
  private previous: Rect[] = [];
  private staticRevision: number | null = null;
  private lastSceneRevision: number | null = null;
  private disposed = false;
  constructor(private readonly canvas: HTMLCanvasElement) {
    const ctx = canvas.getContext('2d', { alpha: true }); if (!ctx) throw new Error('Transparent Canvas 2D unavailable');
    this.ctx = ctx; this.cache = document.createElement('canvas');
  }
  resize(width: number, height: number, pixelRatio: number): void {
    if (this.disposed) return;
    const w = Math.max(1, Math.floor(Number.isFinite(width) ? width : 1));
    const h = Math.max(1, Math.floor(Number.isFinite(height) ? height : 1));
    const ratio = Math.min(2, Math.max(1, Number.isFinite(pixelRatio) ? pixelRatio : 1));
    if (w === this.width && h === this.height && ratio === this.ratio && this.canvas.width > 0) return;
    this.width = w; this.height = h; this.ratio = ratio;
    this.canvas.width = this.cache.width = Math.round(w * ratio);
    this.canvas.height = this.cache.height = Math.round(h * ratio);
    this.ctx.setTransform(ratio, 0, 0, ratio, 0, 0);
    this.staticRevision = this.lastSceneRevision = null; this.previous = [];
  }
  private unit(): number { return Math.max(12, Math.min(this.width / 19, this.height / 12, 38)) }
  private iso(x: number, y: number): { x: number; y: number } {
    const u = this.unit();
    return { x: this.width * .5 + (x - y) * u, y: this.height * .10 + (x + y) * u * .45 };
  }
  private tile(ctx: CanvasRenderingContext2D, x: number, y: number, color: string): void {
    const p = this.iso(x, y), u = this.unit();
    ctx.beginPath(); ctx.moveTo(p.x, p.y); ctx.lineTo(p.x + u, p.y + u * .45);
    ctx.lineTo(p.x, p.y + u * .9); ctx.lineTo(p.x - u, p.y + u * .45);
    ctx.closePath(); ctx.fillStyle = color; ctx.fill();
    ctx.strokeStyle = '#25324a88'; ctx.lineWidth = .7; ctx.stroke();
  }
  private buildTiles(scene: Scene): void {
    const ctx = this.cache.getContext('2d', { alpha: true });
    if (!ctx) throw new Error('Canvas cache unavailable');
    ctx.setTransform(this.ratio, 0, 0, this.ratio, 0, 0);
    ctx.clearRect(0, 0, this.width, this.height);
    for (const tile of scene.tiles) this.tile(ctx, tile.x, tile.y, tile.kind === 'grass' ? '#498d7b' : '#c7b18c');
    this.staticRevision = scene.staticRevision;
  }
  private buildingBounds(b: Building): Rect {
    const p = this.iso(b.x, b.y), u = this.unit();
    return { x: p.x - u * 1.2, y: p.y - u * 2.8, w: u * 2.4, h: u * 3.5 };
  }
  private actorBounds(actor: Actor): Rect {
    const p = this.iso(actor.x, actor.y), u = this.unit();
    return { x: p.x - u * .65 - 3, y: p.y - u * 1.65 - 5, w: u * 1.3 + 6, h: u * 2.05 + 9 };
  }
  private building(ctx: CanvasRenderingContext2D, b: Building): void {
    const p = this.iso(b.x, b.y), u = this.unit();
    const color = b.kind === 'post' ? '#668ebd' : '#b57876';
    ctx.fillStyle = '#14263455'; ctx.beginPath(); ctx.ellipse(p.x, p.y + u * .2, u * 1.05, u * .34, 0, 0, 2 * Math.PI); ctx.fill();
    ctx.fillStyle = color; ctx.fillRect(p.x - u * .75, p.y - u * 1.75, u * 1.5, u * 1.65);
    ctx.beginPath(); ctx.moveTo(p.x - u, p.y - u * 1.75); ctx.lineTo(p.x, p.y - u * 2.55);
    ctx.lineTo(p.x + u, p.y - u * 1.75); ctx.closePath(); ctx.fillStyle = '#6a547f'; ctx.fill();
    ctx.fillStyle = '#162233'; ctx.fillRect(p.x - u * .18, p.y - u * .72, u * .36, u * .65);
    ctx.textAlign = 'center'; ctx.font = `${Math.max(10, u * .32)}px sans-serif`;
    ctx.fillStyle = '#f7f4ff'; ctx.fillText(b.kind === 'post' ? 'MAIL' : 'CAFE', p.x, p.y - u * 1.03);
  }
  private actor(ctx: CanvasRenderingContext2D, actor: Actor): void {
    const p = this.iso(actor.x, actor.y), u = this.unit(), leg = Math.sin(actor.stride) * u * .13;
    ctx.save(); ctx.translate(p.x, p.y);
    ctx.fillStyle = '#14263477'; ctx.beginPath(); ctx.ellipse(0, u * .23, u * .45, u * .14, 0, 0, Math.PI * 2); ctx.fill();
    ctx.strokeStyle = '#2c3547'; ctx.lineWidth = Math.max(2, u * .12); ctx.lineCap = 'round';
    ctx.beginPath(); ctx.moveTo(-u * .16, -u * .12); ctx.lineTo(-u * .16 + leg, u * .23);
    ctx.moveTo(u * .16, -u * .12); ctx.lineTo(u * .16 - leg, u * .23); ctx.stroke();
    ctx.fillStyle = actor.color; ctx.beginPath(); ctx.ellipse(0, -u * .62, u * .41, u * .6, 0, 0, Math.PI * 2); ctx.fill();
    ctx.beginPath(); ctx.arc(0, -u * 1.17, u * .34, 0, Math.PI * 2); ctx.fill();
    ctx.fillStyle = '#253040'; ctx.beginPath(); ctx.arc(actor.facing * u * .14, -u * 1.2, u * .055, 0, Math.PI * 2); ctx.fill();
    ctx.restore();
  }
  /** True iff a draw occurred. Repeated scene revision without invalidation does no work. */
  render(scene: Scene, full = false): boolean {
    if (this.disposed) return false;
    const viewport: Rect = { x: 0, y: 0, w: this.width, h: this.height };
    if (!sceneIsSafe(scene)) {
      this.ctx.clearRect(0, 0, this.width, this.height);
      this.previous = []; this.lastSceneRevision = this.staticRevision = null;
      return false;
    }
    if (this.staticRevision !== scene.staticRevision) { this.buildTiles(scene); full = true; }
    if (!full && this.lastSceneRevision === scene.revision) return false;
    const actorBounds = scene.actors.map(a => this.actorBounds(a));
    const damage = planDamage(this.previous, actorBounds, viewport, full);
    if (!damage.length) { this.previous = actorBounds; this.lastSceneRevision = scene.revision; return false; }
    // Rebuild painter order each scene; actor occlusion follows world depth, not insertion order.
    const items: Item[] = [
      ...scene.buildings.map(b => ({ kind: 'building' as const, building: b, depth: b.x + b.y, bounds: this.buildingBounds(b) })),
      ...scene.actors.map((a, i) => ({ kind: 'actor' as const, actor: a, depth: a.x + a.y, bounds: actorBounds[i] }))
    ].sort((a, b) => a.depth - b.depth || (a.kind === 'building' ? -1 : 1));
    this.ctx.save();
    for (const r of damage) {
      // Align to physical pixels for predictable transparent edges on high-DPI monitors.
      const x = Math.max(0, Math.floor(r.x * this.ratio)), y = Math.max(0, Math.floor(r.y * this.ratio));
      const right = Math.min(this.cache.width, Math.ceil((r.x + r.w) * this.ratio));
      const bottom = Math.min(this.cache.height, Math.ceil((r.y + r.h) * this.ratio));
      if (right <= x || bottom <= y) continue;
      const dst: Rect = { x: x / this.ratio, y: y / this.ratio, w: (right - x) / this.ratio, h: (bottom - y) / this.ratio };
      this.ctx.save(); this.ctx.beginPath(); this.ctx.rect(dst.x, dst.y, dst.w, dst.h); this.ctx.clip();
      this.ctx.clearRect(dst.x, dst.y, dst.w, dst.h);
      this.ctx.drawImage(this.cache, x, y, right - x, bottom - y, dst.x, dst.y, dst.w, dst.h);
      for (const item of items) if (intersect(item.bounds, dst)) {
        if (item.kind === 'actor') this.actor(this.ctx, item.actor); else this.building(this.ctx, item.building);
      }
      this.ctx.restore();
    }
    this.ctx.restore();
    this.previous = actorBounds; this.lastSceneRevision = scene.revision; return true;
  }
  dispose(): void {
    if (this.disposed) return;
    this.disposed = true; this.previous = [];
    this.cache.width = this.cache.height = 0;
    this.canvas.width = this.canvas.height = 0;
  }
}

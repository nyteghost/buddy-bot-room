import { combine, intersect, type Actor, type Rect, type Scene, type SceneRenderer } from './core';
/** Canvas is an interchangeable renderer, not the owner of scene state. */
export class CanvasTownRenderer implements SceneRenderer {
  private ctx: CanvasRenderingContext2D; private cache: HTMLCanvasElement; private width = 1; private height = 1; private ratio = 1;
  private previous: Rect[] = []; private cacheDirty = true;
  constructor(private readonly canvas: HTMLCanvasElement) {
    const ctx = canvas.getContext('2d', { alpha: true }); if (!ctx) throw new Error('Transparent Canvas 2D unavailable');
    this.ctx = ctx; this.cache = document.createElement('canvas');
  }
  resize(width: number, height: number, pixelRatio: number): void {
    this.width = Math.max(1, Math.floor(width)); this.height = Math.max(1, Math.floor(height)); this.ratio = Math.min(2, Math.max(1, pixelRatio || 1));
    this.canvas.width = this.cache.width = Math.round(this.width * this.ratio);
    this.canvas.height = this.cache.height = Math.round(this.height * this.ratio);
    this.ctx.setTransform(this.ratio, 0, 0, this.ratio, 0, 0);
    this.cacheDirty = true; this.previous = [];
  }
  private iso(x: number, y: number): { x: number; y: number } { const unit = Math.max(12, Math.min(this.width / 19, this.height / 12, 38)); return { x: this.width * .5 + (x - y) * unit, y: this.height * .11 + (x + y) * unit * .45 } }
  private unit(): number { return Math.max(12, Math.min(this.width / 19, this.height / 12, 38)) }
  private tile(ctx: CanvasRenderingContext2D, x: number, y: number, color: string): void {
    const p = this.iso(x, y), u = this.unit();
    ctx.beginPath(); ctx.moveTo(p.x, p.y); ctx.lineTo(p.x + u, p.y + u * .45); ctx.lineTo(p.x, p.y + u * .9); ctx.lineTo(p.x - u, p.y + u * .45); ctx.closePath(); ctx.fillStyle = color; ctx.fill(); ctx.strokeStyle = '#25324a88'; ctx.lineWidth = .7; ctx.stroke();
  }
  private building(ctx: CanvasRenderingContext2D, x: number, y: number, color: string, name: string): void {
    const p = this.iso(x, y), u = this.unit();
    ctx.fillStyle = color; ctx.fillRect(p.x - u * .75, p.y - u * 1.75, u * 1.5, u * 1.65);
    ctx.beginPath(); ctx.moveTo(p.x - u, p.y - u * 1.75); ctx.lineTo(p.x, p.y - u * 2.55); ctx.lineTo(p.x + u, p.y - u * 1.75); ctx.closePath(); ctx.fillStyle = '#6a547f'; ctx.fill();
    ctx.fillStyle = '#162233'; ctx.fillRect(p.x - u * .18, p.y - u * .72, u * .36, u * .65);
    ctx.textAlign = 'center'; ctx.font = `${Math.max(10, u * .32)}px sans-serif`; ctx.fillStyle = '#f7f4ff'; ctx.fillText(name, p.x, p.y - u * 1.03);
  }
  private buildStatic(scene: Scene): void {
    const ctx = this.cache.getContext('2d', { alpha: true }); if (!ctx) throw new Error('Canvas cache unavailable');
    ctx.setTransform(this.ratio, 0, 0, this.ratio, 0, 0); ctx.clearRect(0, 0, this.width, this.height);
    for (const tile of scene.tiles) this.tile(ctx, tile.x, tile.y, tile.kind === 'grass' ? '#498d7b' : '#c7b18c');
    for (const building of scene.buildings) this.building(ctx, building.x, building.y, building.kind === 'post' ? '#668ebd' : '#b57876', building.kind === 'post' ? 'MAIL' : 'CAFE');
    this.cacheDirty = false;
  }
  private bounds(actor: Actor): Rect { const p = this.iso(actor.x, actor.y), u = this.unit(); return { x: p.x - u * .65 - 3, y: p.y - u * 1.45 - 5, w: u * 1.3 + 6, h: u * 1.85 + 9 } }
  private actor(ctx: CanvasRenderingContext2D, actor: Actor): void {
    const p = this.iso(actor.x, actor.y), u = this.unit(), leg = Math.sin(actor.stride) * u * .13;
    ctx.save(); ctx.translate(p.x, p.y); ctx.fillStyle = '#14263477'; ctx.beginPath(); ctx.ellipse(0, u * .23, u * .45, u * .14, 0, 0, Math.PI * 2); ctx.fill();
    ctx.strokeStyle = '#2c3547'; ctx.lineWidth = Math.max(2, u * .12); ctx.lineCap = 'round';
    ctx.beginPath(); ctx.moveTo(-u * .16, -u * .12); ctx.lineTo(-u * .16 + leg, u * .23); ctx.moveTo(u * .16, -u * .12); ctx.lineTo(u * .16 - leg, u * .23); ctx.stroke();
    ctx.fillStyle = actor.color; ctx.beginPath(); ctx.ellipse(0, -u * .62, u * .41, u * .6, 0, 0, Math.PI * 2); ctx.fill();
    ctx.beginPath(); ctx.arc(0, -u * 1.17, u * .34, 0, Math.PI * 2); ctx.fill();
    ctx.fillStyle = '#253040'; ctx.beginPath(); ctx.arc(actor.facing * u * .14, -u * 1.2, u * .055, 0, Math.PI * 2); ctx.fill(); ctx.restore();
  }
  render(scene: Scene, full = false): void {
    if (this.cacheDirty) { this.buildStatic(scene); full = true }
    const current = scene.actors.map(actor => this.bounds(actor));
    const dirty: Rect[] = full ? [{ x: 0, y: 0, w: this.width, h: this.height }] : [...this.previous, ...current];
    if (!dirty.length) return;
    // Combine all actor damage for predictable bounded work; background remains alpha-transparent.
    const damage = dirty.reduce(combine);
    this.ctx.save(); this.ctx.beginPath(); this.ctx.rect(damage.x, damage.y, damage.w, damage.h); this.ctx.clip();
    this.ctx.clearRect(damage.x, damage.y, damage.w, damage.h);
    this.ctx.drawImage(this.cache, 0, 0, this.width, this.height);
    scene.actors.forEach((actor, index) => { if (intersect(damage, current[index])) this.actor(this.ctx, actor) });
    this.ctx.restore(); this.previous = current;
  }
  dispose(): void { this.previous = []; this.cache.width = this.cache.height = 0 }
}

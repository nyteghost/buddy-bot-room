/**
 * Camera for a larger Living Universe HD world (prototype groundwork, not wired into the app's rooms).
 *
 * The world is drawn in world pixels; at zoom 1 one world pixel is one CSS pixel. The viewport is the
 * on-screen room box. The camera keeps the viewport inside the world (no empty margins), zooms around a
 * screen point (cursor, pinch centre), pans by screen deltas, and follows a character with a dead zone so
 * small steps never move the camera. Reduced motion snaps instead of easing. Pure and deterministic.
 */
export type WorldSize = Readonly<{ width: number; height: number }>;
export type WorldCamera = Readonly<{ x: number; y: number; zoom: number }>;
export type WorldCameraLimits = Readonly<{ min: number; max: number }>;
export type ScreenPoint = Readonly<{ x: number; y: number }>;

const finite = (v: number, fallback: number) => Number.isFinite(v) ? v : fallback;

/** Smallest zoom that still covers the viewport (no letterboxing) up to `max` (1 = native world detail). */
export function worldCameraLimits(world: WorldSize, viewport: WorldSize, max = 1): WorldCameraLimits {
 const cover = Math.max(viewport.width / Math.max(1, world.width), viewport.height / Math.max(1, world.height));
 return { min: cover, max: Math.max(cover, max) };
}
/** Keep zoom within limits and the viewport inside the world. */
export function worldCameraClamp(camera: WorldCamera, world: WorldSize, viewport: WorldSize, max = 1): WorldCamera {
 const limits = worldCameraLimits(world, viewport, max);
 const zoom = Math.min(limits.max, Math.max(limits.min, finite(camera.zoom, limits.min)));
 const halfW = viewport.width / 2 / zoom, halfH = viewport.height / 2 / zoom;
 const clampAxis = (v: number, half: number, size: number) => half * 2 >= size ? size / 2 : Math.min(size - half, Math.max(half, v));
 return { zoom, x: clampAxis(finite(camera.x, world.width / 2), halfW, world.width), y: clampAxis(finite(camera.y, world.height / 2), halfH, world.height) };
}
/** Whole-room framing. */
export const worldCameraFit = (world: WorldSize, viewport: WorldSize): WorldCamera =>
 worldCameraClamp({ x: world.width / 2, y: world.height / 2, zoom: 0 }, world, viewport);

export function worldToScreen(camera: WorldCamera, viewport: WorldSize, p: ScreenPoint): ScreenPoint {
 return { x: (p.x - camera.x) * camera.zoom + viewport.width / 2, y: (p.y - camera.y) * camera.zoom + viewport.height / 2 };
}
export function screenToWorld(camera: WorldCamera, viewport: WorldSize, p: ScreenPoint): ScreenPoint {
 return { x: (p.x - viewport.width / 2) / camera.zoom + camera.x, y: (p.y - viewport.height / 2) / camera.zoom + camera.y };
}
/** CSS transform for the world layer (transform-origin 0 0). */
export function worldCameraTransform(camera: WorldCamera, viewport: WorldSize): string {
 const tx = viewport.width / 2 - camera.x * camera.zoom, ty = viewport.height / 2 - camera.y * camera.zoom;
 return `translate(${Math.round(tx * 100) / 100}px, ${Math.round(ty * 100) / 100}px) scale(${Math.round(camera.zoom * 10000) / 10000})`;
}

/** Zoom by `factor` keeping the world point under `at` (screen) fixed, as with a cursor or pinch centre. */
export function worldCameraZoomAt(camera: WorldCamera, factor: number, at: ScreenPoint, world: WorldSize, viewport: WorldSize, max = 1): WorldCamera {
 const anchor = screenToWorld(camera, viewport, at);
 const limits = worldCameraLimits(world, viewport, max);
 const zoom = Math.min(limits.max, Math.max(limits.min, camera.zoom * (Number.isFinite(factor) && factor > 0 ? factor : 1)));
 const next = { zoom, x: anchor.x - (at.x - viewport.width / 2) / zoom, y: anchor.y - (at.y - viewport.height / 2) / zoom };
 return worldCameraClamp(next, world, viewport, max);
}
/** Drag the world by a screen delta (content follows the finger/cursor). */
export function worldCameraPan(camera: WorldCamera, dx: number, dy: number, world: WorldSize, viewport: WorldSize, max = 1): WorldCamera {
 return worldCameraClamp({ ...camera, x: camera.x - finite(dx, 0) / camera.zoom, y: camera.y - finite(dy, 0) / camera.zoom }, world, viewport, max);
}
/** Two-finger gesture: zoom by the change in finger distance around their midpoint, and pan with the midpoint. */
export function worldCameraPinch(camera: WorldCamera, from: readonly [ScreenPoint, ScreenPoint], to: readonly [ScreenPoint, ScreenPoint], world: WorldSize, viewport: WorldSize, max = 1): WorldCamera {
 const d = (a: ScreenPoint, b: ScreenPoint) => Math.hypot(a.x - b.x, a.y - b.y);
 const mid = (a: ScreenPoint, b: ScreenPoint) => ({ x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 });
 const start = d(from[0], from[1]), now = d(to[0], to[1]);
 const m0 = mid(from[0], from[1]), m1 = mid(to[0], to[1]);
 const zoomed = worldCameraZoomAt(camera, start > 4 ? now / start : 1, m0, world, viewport, max);
 return worldCameraPan(zoomed, m1.x - m0.x, m1.y - m0.y, world, viewport, max);
}
/**
 * Follow a target: nothing happens while it stays inside the central dead zone (fraction of the viewport);
 * outside it the camera eases towards keeping the target at the dead-zone edge. Reduced motion snaps.
 */
export function worldCameraFollow(camera: WorldCamera, target: ScreenPoint, dt: number, world: WorldSize, viewport: WorldSize,
 { deadZone = 0.3, halfLifeMs = 260, reduced = false, max = 1 }: { deadZone?: number; halfLifeMs?: number; reduced?: boolean; max?: number } = {}): WorldCamera {
 const halfW = viewport.width * deadZone / 2 / camera.zoom, halfH = viewport.height * deadZone / 2 / camera.zoom;
 const want = (c: number, t: number, half: number) => t > c + half ? t - half : t < c - half ? t + half : c;
 const goal = { x: want(camera.x, target.x, halfW), y: want(camera.y, target.y, halfH) };
 const k = reduced ? 1 : 1 - Math.pow(0.5, Math.max(0, finite(dt, 0)) / Math.max(1, halfLifeMs));
 return worldCameraClamp({ zoom: camera.zoom, x: camera.x + (goal.x - camera.x) * k, y: camera.y + (goal.y - camera.y) * k }, world, viewport, max);
}
/** World-space rectangle currently on screen (for culling off-screen characters). */
export function worldCameraVisible(camera: WorldCamera, viewport: WorldSize, margin = 0) {
 const w = viewport.width / camera.zoom, h = viewport.height / camera.zoom;
 return { x1: camera.x - w / 2 - margin, y1: camera.y - h / 2 - margin, x2: camera.x + w / 2 + margin, y2: camera.y + h / 2 + margin };
}

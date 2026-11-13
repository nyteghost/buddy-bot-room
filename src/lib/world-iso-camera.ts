import type { WorldCamera, WorldSize, ScreenPoint } from "./world-camera";
import { screenToWorld } from "./world-camera";
import { WORLD_ISO_CANVAS } from "./world-iso-projection";

/** Isometric camera uses contain-fit: unlike the flat HD camera, it never crops
 * the floor just to fill a narrow floating workspace. Blank margins are safe. */
const width = WORLD_ISO_CANVAS.width, height = WORLD_ISO_CANVAS.height;
const safe = (n: number, fallback: number) => Number.isFinite(n) && n > 0 ? n : fallback;
const view = (v: WorldSize): WorldSize => ({ width: safe(v.width, 900), height: safe(v.height, 520) });
const minimum = (v: WorldSize) => Math.min(v.width / width, v.height / height);

export function worldIsoCameraFit(viewport: WorldSize): WorldCamera {
 const v = view(viewport);
 return { x: width / 2, y: height / 2, zoom: minimum(v) };
}
export function worldIsoCameraClamp(camera: WorldCamera, viewport: WorldSize): WorldCamera {
 const v = view(viewport), min = minimum(v);
 const zoom = Math.max(min, Math.min(Math.max(2, min), safe(camera.zoom, min)));
 const halfX = v.width / (2 * zoom), halfY = v.height / (2 * zoom);
 const clampAxis = (n: number, half: number, world: number) =>
  half >= world / 2 ? world / 2 : Math.max(half, Math.min(world - half, Number.isFinite(n) ? n : world / 2));
 return { zoom, x: clampAxis(camera.x, halfX, width), y: clampAxis(camera.y, halfY, height) };
}
export function worldIsoCameraPan(camera: WorldCamera, dx: number, dy: number, viewport: WorldSize): WorldCamera {
 const c = worldIsoCameraClamp(camera, viewport);
 return worldIsoCameraClamp({ ...c, x: c.x - (Number.isFinite(dx) ? dx : 0) / c.zoom,
  y: c.y - (Number.isFinite(dy) ? dy : 0) / c.zoom }, viewport);
}
export function worldIsoCameraZoomAt(camera: WorldCamera, factor: number, at: ScreenPoint, viewport: WorldSize): WorldCamera {
 const v = view(viewport), c = worldIsoCameraClamp(camera, v);
 const anchor = screenToWorld(c, v, at);
 const zoom = Math.max(minimum(v), Math.min(Math.max(2, minimum(v)), c.zoom * (Number.isFinite(factor) && factor > 0 ? factor : 1)));
 return worldIsoCameraClamp({ zoom, x: anchor.x - (at.x - v.width / 2) / zoom,
  y: anchor.y - (at.y - v.height / 2) / zoom }, v);
}
export function worldIsoCameraPinch(camera: WorldCamera, before: readonly [ScreenPoint, ScreenPoint],
 after: readonly [ScreenPoint, ScreenPoint], viewport: WorldSize): WorldCamera {
 const mid = (p: readonly [ScreenPoint, ScreenPoint]) => ({ x: (p[0].x + p[1].x) / 2, y: (p[0].y + p[1].y) / 2 });
 const dist = (p: readonly [ScreenPoint, ScreenPoint]) => Math.hypot(p[0].x - p[1].x, p[0].y - p[1].y);
 const start = dist(before), end = dist(after), b = mid(before), a = mid(after);
 return worldIsoCameraPan(worldIsoCameraZoomAt(camera, start > 4 ? end / start : 1, b, viewport),
  a.x - b.x, a.y - b.y, viewport);
}
export function worldIsoCameraFollow(camera: WorldCamera, target: ScreenPoint, viewport: WorldSize): WorldCamera {
 const c = worldIsoCameraClamp(camera, viewport), v = view(viewport);
 const halfX = v.width * 0.15 / c.zoom, halfY = v.height * 0.15 / c.zoom;
 const destinationX = target.x > c.x + halfX ? target.x - halfX : target.x < c.x - halfX ? target.x + halfX : c.x;
 const destinationY = target.y > c.y + halfY ? target.y - halfY : target.y < c.y - halfY ? target.y + halfY : c.y;
 return worldIsoCameraClamp({ ...c, x: c.x + (destinationX - c.x) * 0.4,
  y: c.y + (destinationY - c.y) * 0.4 }, v);
}

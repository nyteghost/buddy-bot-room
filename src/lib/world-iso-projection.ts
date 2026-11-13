/**
 * Living Universe — isometric ground engine (Step 1a): projection.
 *
 * Pure maths, not yet used by any room. Everything that moves or collides in an isometric room lives on
 * the ground in tile units (u, v); only drawing happens in screen space. A `WorldProjection` turns ground
 * points into world pixels and back, so navigation, crowding and depth code never depend on the picture.
 *
 * Two implementations:
 * - `iso`: the approved 2:1 dimetric ("pixel isometric") projection. A floor tile is a diamond twice as
 *   wide as it is tall. Ground +u runs down-right on screen, +v runs down-left.
 *     x = ox + (u − v) · W/2
 *     y = oy + (u + v) · W/4 − h · Zs      (h = height above the floor in tiles)
 * - `flat`: today's HD office maths (feet in percent of the world picture), kept so the current room can
 *   use the same interface later without any change in behaviour.
 */
export type GroundPoint = Readonly<{ u: number; v: number }>;
export type ScreenPoint = Readonly<{ x: number; y: number }>;
export type WorldProjectionKind = "flat" | "iso";

export interface WorldProjection {
 readonly kind: WorldProjectionKind;
 /** Ground point (and optional height in ground units) → world pixels. */
 toScreen(point: GroundPoint, height?: number): ScreenPoint;
 /** World pixels → ground point on the floor (height 0). Exact inverse of `toScreen` at height 0. */
 toGround(point: ScreenPoint): GroundPoint;
 /** Draw-order key for a point on the floor: larger is nearer the viewer. */
 depthOf(point: GroundPoint): number;
 /** On-screen direction (world px) of a ground movement; used to choose a facing. */
 screenVector(du: number, dv: number): ScreenPoint;
}

export type WorldIsoParams = Readonly<{
 /** Width of one floor tile diamond in world px (height is half of it). */
 tileWidth: number;
 /** World px of ground point (0, 0), the floor's back corner. */
 origin: ScreenPoint;
 /** World px per tile of height (walls, shelves, lamps). */
 heightScale: number;
}>;

/** Approved Desktop HD values: 128 × 64 tiles, ground (0, 0) at (1216, 400) on the 2752 × 1600 canvas. */
export const WORLD_ISO_PARAMS: WorldIsoParams = Object.freeze({ tileWidth: 128, origin: Object.freeze({ x: 1216, y: 400 }), heightScale: 64 });
/** Approved floor size of the Desktop HD isometric Office, in tiles. */
export const WORLD_ISO_FLOOR = Object.freeze({ u: 19, v: 14 });
/** World canvas shared with today's HD office. */
export const WORLD_ISO_CANVAS = Object.freeze({ width: 2752, height: 1600 });

const finite = (n: number) => typeof n === "number" && Number.isFinite(n);

export function worldIsoProjection(params: WorldIsoParams = WORLD_ISO_PARAMS): WorldProjection {
 const { tileWidth, origin, heightScale } = params;
 if (!finite(tileWidth) || tileWidth <= 0 || !finite(origin.x) || !finite(origin.y) || !finite(heightScale) || heightScale < 0)
  throw new RangeError("Isometric projection needs a positive tile width, a finite origin and a non-negative height scale.");
 const hw = tileWidth / 2, hh = tileWidth / 4;
 return Object.freeze({
  kind: "iso" as const,
  toScreen: (p: GroundPoint, height = 0) => ({ x: origin.x + (p.u - p.v) * hw, y: origin.y + (p.u + p.v) * hh - height * heightScale }),
  toGround: (s: ScreenPoint) => {
   const a = (s.x - origin.x) / hw, b = (s.y - origin.y) / hh;
   return { u: (a + b) / 2, v: (b - a) / 2 };
  },
  depthOf: (p: GroundPoint) => p.u + p.v,
  screenVector: (du: number, dv: number) => ({ x: (du - dv) * hw, y: (du + dv) * hh }),
 });
}

/**
 * Today's flat HD office as a projection: ground (u, v) are the existing feet percentages (x of width,
 * y of height), so `toScreen` is exactly the current `x / 100 * W, y / 100 * H` and `depthOf` orders like
 * the current `z-index = round(y * 10)`. Height is ignored (the flat room has no height axis).
 */
export function worldFlatProjection(world: Readonly<{ width: number; height: number }> = WORLD_ISO_CANVAS): WorldProjection {
 const { width, height } = world;
 if (!finite(width) || !finite(height) || width <= 0 || height <= 0) throw new RangeError("Flat projection needs a positive world size.");
 return Object.freeze({
  kind: "flat" as const,
  toScreen: (p: GroundPoint) => ({ x: p.u / 100 * width, y: p.v / 100 * height }),
  toGround: (s: ScreenPoint) => ({ u: s.x / width * 100, v: s.y / height * 100 }),
  depthOf: (p: GroundPoint) => p.v,
  screenVector: (du: number, dv: number) => ({ x: du / 100 * width, y: dv / 100 * height }),
 });
}

/** World-px corners of an iso floor of `floor` tiles: back, right, front, left. */
export function worldIsoFloorCorners(projection: WorldProjection, floor: Readonly<{ u: number; v: number }> = WORLD_ISO_FLOOR): ScreenPoint[] {
 return [projection.toScreen({ u: 0, v: 0 }), projection.toScreen({ u: floor.u, v: 0 }), projection.toScreen({ u: floor.u, v: floor.v }), projection.toScreen({ u: 0, v: floor.v })];
}

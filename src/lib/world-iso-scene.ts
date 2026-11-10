import type { WorldHdDirection } from "./world-hd";
import { worldIsoSliceBox, type WorldIsoDepthItem } from "./world-iso-depth";
import { WORLD_ISO_FACING_ANGLES } from "./world-iso-facing";
import { WORLD_ISO_GREYBOX } from "./world-iso-greybox";
import { WORLD_ISO_FOOTPRINT, worldIsoValidatePlan, type GroundAnchorKind, type GroundBox, type GroundPlan, type GroundPlanProblem } from "./world-iso-ground";
import { WORLD_ISO_CANVAS, worldIsoProjection, type GroundPoint, type ScreenPoint, type WorldProjection } from "./world-iso-projection";

/**
 * Living Universe — Isometric Office preview (Step 1b, Stage 2): synthetic grey-box scene geometry.
 *
 * Turns a validated ground plan into things a renderer can draw without any artwork: the floor outline and
 * tile grid, back walls, one grey block per collider (a made-up height, three visible faces), and markers
 * for seats, standing spots, visitor homes and the door, each with a ground wedge showing its facing.
 * Everything is in world pixels on the shared 2752 × 1600 canvas, using the approved 2:1 projection.
 * It also returns the draw items for the Step 1a depth sort. Pure; computed once per plan.
 *
 * The heights are placeholders for the engineering proof only. They say nothing about final furniture art.
 */
export type WorldIsoSceneProp = Readonly<{
 /** Draw id (a collider id, or `${id}#n` for a slice of a long prop). */ id: string;
 /** The collider this block belongs to. */ collider: string;
 box: GroundBox;
 /** Placeholder height in tiles. */ height: number;
 /** Screen polygons of the three visible faces. */ top: readonly ScreenPoint[]; left: readonly ScreenPoint[]; right: readonly ScreenPoint[];
 /** Screen bounds of the whole block. */ bounds: Readonly<{ x: number; y: number; width: number; height: number }>;
}>;
export type WorldIsoSceneMarker = Readonly<{
 id: string; kind: GroundAnchorKind; at: GroundPoint; screen: ScreenPoint; facing: WorldHdDirection; desk?: number;
 /** Ground wedge (three screen points) pointing where a character at this anchor faces. */ wedge: readonly ScreenPoint[];
}>;
export type WorldIsoScene = Readonly<{
 ok: true;
 /** The sealed plan the scene was built from. */ plan: GroundPlan;
 canvas: Readonly<{ width: number; height: number }>;
 floor: readonly ScreenPoint[];
 /** Tile grid lines clipped to the floor's bounding box. */ grid: readonly (readonly [ScreenPoint, ScreenPoint])[];
 /** Back walls (screen polygons), drawn behind everything. */ walls: readonly (readonly ScreenPoint[])[];
 props: readonly WorldIsoSceneProp[];
 markers: readonly WorldIsoSceneMarker[];
 /** Depth-sort input for the props; characters are added per frame. */ depthItems: readonly WorldIsoDepthItem[];
}>;
export type WorldIsoSceneFailure = Readonly<{ ok: false; problems: readonly GroundPlanProblem[] }>;

/** Placeholder block heights in tiles, by collider id prefix (64 px per tile). */
const HEIGHTS: readonly (readonly [string, number])[] = [["desk", 1.1], ["sofa", 0.8], ["coffee-table", 0.5], ["coffee-counter", 1.2], ["shelf", 4.7], ["plant", 1.5]];
export const WORLD_ISO_WALL_HEIGHT = 4;
export function worldIsoPropHeight(id: string): number {
 for (const [prefix, h] of HEIGHTS) if (id.startsWith(prefix)) return h;
 return 0.8;
}

/** Three screen points: a wedge on the ground at `at`, pointing in `facing`. */
export function worldIsoFacingWedge(projection: WorldProjection, at: GroundPoint, facing: WorldHdDirection, size = 30): ScreenPoint[] {
 const s = projection.toScreen(at), a = WORLD_ISO_FACING_ANGLES[facing] * Math.PI / 180;
 const dir = { x: Math.cos(a), y: Math.sin(a) }, side = { x: -dir.y, y: dir.x };
 const tip = { x: s.x + dir.x * size, y: s.y + dir.y * size }, base = { x: s.x + dir.x * size * 0.35, y: s.y + dir.y * size * 0.35 };
 return [tip, { x: base.x + side.x * size * 0.3, y: base.y + side.y * size * 0.3 }, { x: base.x - side.x * size * 0.3, y: base.y - side.y * size * 0.3 }];
}

const freeze = <T>(xs: T[]): readonly T[] => Object.freeze(xs);
/**
 * Build the grey-box scene. The plan is fully validated first (structure, limits, geometry, anchors,
 * reachability); anything invalid returns `{ ok: false, problems }` and nothing to draw.
 */
export function worldIsoScene(rawPlan: unknown = WORLD_ISO_GREYBOX, projection: WorldProjection = worldIsoProjection(), radius: number = WORLD_ISO_FOOTPRINT): WorldIsoScene | WorldIsoSceneFailure {
 const report = worldIsoValidatePlan(rawPlan, radius);
 if (!report.ok || !report.plan) return { ok: false, problems: report.problems };
 const plan = report.plan, P = (u: number, v: number, h = 0) => projection.toScreen({ u, v }, h);
 const us = plan.floor.map(p => p.u), vs = plan.floor.map(p => p.v);
 const u1 = Math.min(...us), u2 = Math.max(...us), v1 = Math.min(...vs), v2 = Math.max(...vs);
 const grid: [ScreenPoint, ScreenPoint][] = [];
 for (let u = Math.ceil(u1); u <= Math.floor(u2); u++) grid.push([P(u, v1), P(u, v2)]);
 for (let v = Math.ceil(v1); v <= Math.floor(v2); v++) grid.push([P(u1, v), P(u2, v)]);
 // Back walls: floor edges that lie on the far (minimum u or minimum v) side of the floor.
 const walls: ScreenPoint[][] = [];
 for (let i = 0; i < plan.floor.length; i++) {
  const a = plan.floor[i]!, b = plan.floor[(i + 1) % plan.floor.length]!;
  if ((a.u === u1 && b.u === u1) || (a.v === v1 && b.v === v1)) walls.push([P(a.u, a.v), P(b.u, b.v), P(b.u, b.v, WORLD_ISO_WALL_HEIGHT), P(a.u, a.v, WORLD_ISO_WALL_HEIGHT)]);
 }
 const props: WorldIsoSceneProp[] = [], depthItems: WorldIsoDepthItem[] = [];
 for (const collider of plan.colliders) for (const box of worldIsoSliceBox(collider)) {
  const h = worldIsoPropHeight(collider.id);
  const top = [P(box.u1, box.v1, h), P(box.u2, box.v1, h), P(box.u2, box.v2, h), P(box.u1, box.v2, h)];
  const left = [P(box.u1, box.v2), P(box.u2, box.v2), P(box.u2, box.v2, h), P(box.u1, box.v2, h)];
  const right = [P(box.u2, box.v1), P(box.u2, box.v2), P(box.u2, box.v2, h), P(box.u2, box.v1, h)];
  const all = [...top, ...left, ...right], xs = all.map(p => p.x), ys = all.map(p => p.y);
  const x = Math.min(...xs), y = Math.min(...ys);
  props.push(Object.freeze({ id: box.id, collider: collider.id, box, height: h, top: freeze(top), left: freeze(left), right: freeze(right), bounds: Object.freeze({ x, y, width: Math.max(...xs) - x, height: Math.max(...ys) - y }) }));
  depthItems.push(Object.freeze({ id: box.id, layer: "prop" as const, box: Object.freeze({ u1: box.u1, v1: box.v1, u2: box.u2, v2: box.v2 }) }));
 }
 const markers = plan.anchors.map(a => Object.freeze({
  id: a.id, kind: a.kind, at: a.at, screen: projection.toScreen(a.at), facing: a.facing, ...(a.desk !== undefined ? { desk: a.desk } : {}),
  wedge: freeze(worldIsoFacingWedge(projection, a.at, a.facing)),
 }));
 return Object.freeze({
  ok: true as const, plan, canvas: WORLD_ISO_CANVAS, floor: freeze(plan.floor.map(p => projection.toScreen(p))),
  grid: freeze(grid), walls: freeze(walls), props: freeze(props), markers: freeze(markers), depthItems: freeze(depthItems),
 });
}

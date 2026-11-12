import type { WorldHdDirection } from "./world-hd";
import { worldIsoActorBox, worldIsoDepthOrder, type WorldIsoDepthItem, type WorldIsoDepthResult } from "./world-iso-depth";
import { worldIsoPlanSealed, worldIsoPointFree, type GroundBox, type GroundPlan } from "./world-iso-ground";
import type { GroundPoint } from "./world-iso-projection";
import { WORLD_ISO_GREYBOX } from "./world-iso-greybox";
import { WORLD_ISO_CANVAS, WORLD_ISO_FLOOR, worldIsoProjection, type ScreenPoint } from "./world-iso-projection";
import type { WorldIsoRealActivity } from "./world-iso-schedule";

/** Data, not art: Stage 2 builds a synthetic 2:1 grid and a deterministic draw order. */
export type WorldIsoSceneActor = Readonly<{
 id: string; name: string; at: GroundPoint; facing: WorldHdDirection; kind: "pal" | "visitor";
 real: WorldIsoRealActivity; walking: boolean;
}>;
export type WorldIsoSceneProp = Readonly<{ id: string; box: GroundBox; diamond: readonly ScreenPoint[]; feet: ScreenPoint }>;
export type WorldIsoSceneMarker = WorldIsoSceneActor & Readonly<{ feet: ScreenPoint }>;
export type WorldIsoScene = Readonly<{
 width: number; height: number;
 floor: readonly ScreenPoint[];
 grid: readonly (readonly [ScreenPoint, ScreenPoint])[];
 props: readonly WorldIsoSceneProp[];
 actors: readonly WorldIsoSceneMarker[];
 order: WorldIsoDepthResult;
}>;

const iso = worldIsoProjection();
const diamond = (box: GroundBox): ScreenPoint[] => [
 iso.toScreen({ u: box.u1, v: box.v1 }), iso.toScreen({ u: box.u2, v: box.v1 }),
 iso.toScreen({ u: box.u2, v: box.v2 }), iso.toScreen({ u: box.u1, v: box.v2 }),
];

/** Empty/unsealed/malformed scene is rejected, never silently drawn over the current room. */
export function worldIsoSceneFrame(plan: GroundPlan = WORLD_ISO_GREYBOX, actors: readonly WorldIsoSceneActor[] = []): WorldIsoScene | null {
 if (!worldIsoPlanSealed(plan) || actors.length > 15 || new Set(actors.map(a => a.id)).size !== actors.length ||
  actors.some(a => !worldIsoPointFree(plan, a.at))) return null;
 const { floor, colliders } = plan;
 const us = floor.map(p => p.u), vs = floor.map(p => p.v);
 const u1 = Math.min(...us), u2 = Math.max(...us), v1 = Math.min(...vs), v2 = Math.max(...vs);
 if (![u1, u2, v1, v2].every(Number.isFinite)) return null;
 const grid: [ScreenPoint, ScreenPoint][] = [];
 // Scene visualization is intentionally capped to the approved Office, not a room-pack renderer.
 for (let u = Math.ceil(u1); u <= Math.floor(u2) && grid.length < 500; u++)
  grid.push([iso.toScreen({ u, v: v1 }), iso.toScreen({ u, v: v2 })]);
 for (let v = Math.ceil(v1); v <= Math.floor(v2) && grid.length < 500; v++)
  grid.push([iso.toScreen({ u: u1, v }), iso.toScreen({ u: u2, v })]);
 const props = colliders.map(box => ({ id: box.id, box, diamond: diamond(box), feet: iso.toScreen({ u: (box.u1 + box.u2) / 2, v: (box.v1 + box.v2) / 2 }) }));
 const markers = actors.map(a => ({ ...a, feet: iso.toScreen(a.at) }));
 const items: WorldIsoDepthItem[] = [
  ...colliders.map(box => ({ id: "prop:" + box.id, layer: "prop" as const, box })),
  ...actors.map(a => ({ id: a.id, layer: "actor" as const, box: worldIsoActorBox(a.at) })),
 ];
 const order = worldIsoDepthOrder(items);
 if (order.invalidIds.length || order.overLimit || order.cycles) return null;
 return { width: WORLD_ISO_CANVAS.width, height: WORLD_ISO_CANVAS.height,
  floor: floor.map(p => iso.toScreen(p)), grid, props, actors: markers, order };
}

/** Design dimensions used for preview tests, not a production room pack. */
export const WORLD_ISO_PREVIEW_SIZE = Object.freeze({ ...WORLD_ISO_CANVAS, tiles: { ...WORLD_ISO_FLOOR } });

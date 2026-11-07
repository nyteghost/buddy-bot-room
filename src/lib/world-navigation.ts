import type { AgentId } from "./agents";
import type { CharacterMode } from "./hellraiser";
import { officePose, type Heading } from "./office-motion";
import { worldDepthScale, worldPath, worldRoomPlan, type WorldPoint } from "./world-floor";
import { worldWanderPlan, worldWanderPose } from "./world-wander";

export {
 worldDepthScale, worldDepthZ, worldHeadingOf, worldPath, worldPointIsWalkable, worldRoomPlan, worldScreenDistance,
 worldSegmentClear, worldSmoothPath, worldSnap,
} from "./world-floor";
export type { WorldBounds, WorldFixture, WorldFixtureKind, WorldObstacle, WorldPoint, WorldRoomPlan } from "./world-floor";

const aIds: AgentId[] = ["nova", "byte", "sage", "pip", "echo", "rune", "claude", "saiyan", "mimic"];
/** Office-style themes keep the original desk choreography for the nine Pals. */
export const worldUsesOfficeChoreography = (theme: CharacterMode) => theme === "linux" || theme === "assistant" || theme === "devteam";
/**
 * Perspective scale for a visitor at floor depth y. Office-choreography rooms draw their Pals at one
 * fixed size (no perspective), so visitors there use the same size instead of shrinking toward the back.
 */
export const worldActorDepthScale = (theme: CharacterMode, y: number) => worldUsesOfficeChoreography(theme) ? 1 : worldDepthScale(y);

const routeCache = new Map<string, readonly WorldPoint[]>();
/** A Pal's home → visit foot path (kept for compatibility and tests). */
export function worldRoute(id: AgentId, theme: CharacterMode): readonly WorldPoint[] {
 const key = theme + ":" + id, existing = routeCache.get(key);
 if (existing) return existing;
 const index = Math.max(0, aIds.indexOf(id)), plan = worldRoomPlan(theme);
 const path = worldPath(plan.homes[index]!, plan.visits[index]!, theme);
 routeCache.set(key, path);
 return path;
}

export const WORLD_PAL_PERIOD = 32000;
export type WorldPose = {
 x: number; y: number; heading: Heading; walking: boolean; facingLeft: boolean;
 action: "idle" | "walk" | "wave" | "work" | "rest" | "look" | "celebrate";
 /** Furniture the Pal is using, if any (cosmetic glow only). */
 fixture?: string;
};
/**
 * Each Pal wanders its own neighbourhood on a 32-second loop that starts and ends at its home spot:
 * steady walking speed, turns in place, looks around, waves, rests and uses nearby furniture.
 * Deterministic: no random teleports and no frame-rate-dependent routing.
 */
export function worldPose(id: AgentId, index: number, elapsed: number, theme: CharacterMode): WorldPose {
 if (worldUsesOfficeChoreography(theme)) {
  const office = officePose(id, index, elapsed);
  return { ...office, action: office.walking ? "walk" : "idle" };
 }
 const plan = worldRoomPlan(theme), slot = Math.max(0, aIds.indexOf(id));
 const wander = worldWanderPlan({ theme, seed: "pal:" + id, start: plan.homes[slot] ?? plan.homes[0]!, legs: 4, period: WORLD_PAL_PERIOD, roam: 34 });
 const pose = worldWanderPose(wander, (Number.isFinite(elapsed) ? elapsed : 0) + index * 2550);
 const action: WorldPose["action"] = pose.action === "walk" ? "walk" : pose.action === "interaction" ? "work" :
  pose.action === "turn" ? "idle" : pose.action;
 return { x: pose.x, y: pose.y, heading: pose.facing, walking: pose.walking, facingLeft: pose.facing.includes("w"), action,
  ...(pose.fixture ? { fixture: pose.fixture } : {}) };
}

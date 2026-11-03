import type { AgentId } from "./agents";

/** Purely visual poses; they never imply machine access or background work. */
export type PalMotion = "idle" | "look" | "wave" | "stretch" | "talk" | "work" | "rest" | "celebrate" | "walk";
const order: AgentId[] = ["nova", "byte", "sage", "pip", "echo", "rune", "claude", "saiyan", "mimic"];
const gestures: PalMotion[] = ["idle", "look", "idle", "wave", "idle", "stretch", "look", "idle"];
export function ambientMotion(id: AgentId, phase: number): PalMotion {
  const safe = Number.isFinite(phase) ? Math.max(0, Math.floor(phase)) : 0;
  return gestures[(safe + order.indexOf(id) * 3) % gestures.length] ?? "idle";
}
export function motionProfile(id: AgentId) {
  const i = Math.max(0, order.indexOf(id));
  return { gaitMs: [520, 460, 580, 440, 560, 500, 600, 420, 540][i]!, delayMs: -(i * 470), breatheMs: 3200 + i * 170 };
}
/** Ease at each waypoint without changing the route's endpoints or time budget. */
export const easeWalk = (ratio: number) => {
  const t = Math.max(0, Math.min(1, Number.isFinite(ratio) ? ratio : 0));
  return t * t * (3 - 2 * t);
};

/** Paused tabs must not teleport a Pal through minutes of route time on return. */
export const advanceMotionClock = (previous: number, deltaMs: number) =>
  (Number.isFinite(previous) ? previous : 0) + Math.max(0, Math.min(250, Number.isFinite(deltaMs) ? deltaMs : 0));

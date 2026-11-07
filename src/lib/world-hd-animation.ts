import type { WorldHdAction, WorldHdCharacter, WorldHdClip, WorldHdDirection } from "./world-hd";

const COMPASS: readonly WorldHdDirection[] = ["n", "ne", "e", "se", "s", "sw", "w", "nw"];
/** The two directions 45° either side, nearer-to-front (south) first, so a turn keeps facing the viewer. */
export function worldHdNeighbours(direction: WorldHdDirection): WorldHdDirection[] {
 const index = COMPASS.indexOf(direction);
 const both = [COMPASS[(index + 7) % 8]!, COMPASS[(index + 1) % 8]!];
 const towardFront = (d: WorldHdDirection) => Math.abs(((COMPASS.indexOf(d) - 4 + 12) % 8) - 4);
 return both.sort((a, b) => towardFront(a) - towardFront(b));
}
/**
 * Pick supplied artwork for a facing and action. Directional art is never synthesized or mirrored:
 * 1. that direction's own clip; 2. if the pack has no art at all for that direction, the same action
 * from a direction 45° away (e.g. east walk for a south-east step); 3. that direction's idle;
 * 4. a 45°-neighbour's idle; 5. south idle.
 */
export function selectWorldHdClip(character: WorldHdCharacter, direction: WorldHdDirection, action: WorldHdAction) {
 const facing = character.directions[direction];
 if (facing?.[action]) return { clip: facing[action], direction, action };
 const near = facing ? [] : worldHdNeighbours(direction);
 for (const other of near) {
  const clip = character.directions[other]?.[action];
  if (clip) return { clip, direction: other, action };
 }
 if (facing?.idle) return { clip: facing.idle, direction, action: "idle" as const };
 for (const other of near) {
  const clip = character.directions[other]?.idle;
  if (clip) return { clip, direction: other, action: "idle" as const };
 }
 return { clip: character.directions.s!.idle!, direction: "s" as const, action: "idle" as const };
}

export function worldHdFrameAt(clip: WorldHdClip, elapsedMs: number) {
 const total = clip.frames.reduce((sum, frame) => sum + frame.durationMs, 0);
 const elapsed = Number.isFinite(elapsedMs) ? Math.max(0, elapsedMs) : 0;
 let remaining = clip.loop ? elapsed % total : Math.min(elapsed, total - 1);
 for (const frame of clip.frames) {
  if (remaining < frame.durationMs) return frame.src;
  remaining -= frame.durationMs;
 }
 return clip.frames[clip.frames.length - 1]!.src;
}

export function worldHdAction(action: string): WorldHdAction {
 if (["walk", "walking", "return", "retreat"].includes(action)) return "walk";
 if (action === "look") return "turn";
 if (["idle", "run", "turn", "talk", "wave", "celebrate", "emote", "signature", "rest", "interaction"].includes(action)) return action as WorldHdAction;
 return "idle";
}

/** Clips the Living World room asks for, most visible first. */
export const WORLD_HD_ROOM_ACTIONS: readonly WorldHdAction[] = ["walk", "wave", "talk", "celebrate", "signature", "interaction", "turn", "rest"];
export type WorldHdCoverage = {
 status: WorldHdCharacter["artStatus"];
 /** Facings with their own idle art (8 = full turnaround). */
 facings: number;
 /** Facings with a walk clip of 2+ frames. */
 walkingFacings: number;
 /** Actions with at least one 2+ frame clip. */
 animated: WorldHdAction[];
 /** Actions supplied only as single held poses. */
 poses: WorldHdAction[];
 /** Room actions with no art at all (the room shows idle instead). */
 missing: WorldHdAction[];
 summary: string;
};
/** Honest, owner-facing description of what an HD256 pack actually contains. */
export function worldHdCoverage(character: WorldHdCharacter): WorldHdCoverage {
 const facings = Object.values(character.directions).filter(actions => actions?.idle).length;
 const walkingFacings = Object.values(character.directions).filter(actions => (actions?.walk?.frames.length ?? 0) > 1).length;
 const walkFrames = Math.max(0, ...Object.values(character.directions).map(actions => actions?.walk?.frames.length ?? 0));
 const supplied = new Map<WorldHdAction, number>();
 for (const actions of Object.values(character.directions)) for (const [action, clip] of Object.entries(actions ?? {}))
  supplied.set(action as WorldHdAction, Math.max(supplied.get(action as WorldHdAction) ?? 0, clip?.frames.length ?? 0));
 const animated = [...supplied].filter(([, frames]) => frames > 1).map(([action]) => action);
 const poses = [...supplied].filter(([action, frames]) => frames === 1 && action !== "idle").map(([action]) => action);
 const missing = WORLD_HD_ROOM_ACTIONS.filter(action => !supplied.has(action));
 const label = character.artStatus === "prototype" ? "Prototype" : "Marked production-approved by pack author";
 const parts = [label, `${facings}/8 facings`, walkingFacings ? `${walkFrames}-frame walk in ${walkingFacings}/8` : "no walk cycle"];
 if (animated.length) parts.push("animated: " + animated.join(", "));
 if (poses.length) parts.push("single poses: " + poses.join(", "));
 if (missing.length) parts.push("missing: " + missing.join(", ") + " (room uses idle or a nearby facing)");
 return { status: character.artStatus, facings, walkingFacings, animated, poses, missing, summary: parts.join(" · ") };
}

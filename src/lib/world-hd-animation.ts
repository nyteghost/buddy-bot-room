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

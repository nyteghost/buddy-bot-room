import type { WorldHdAction, WorldHdCharacter, WorldHdClip, WorldHdDirection } from "./world-hd";

/** Missing artwork uses an existing idle view; directional art is never synthesized. */
export function selectWorldHdClip(character: WorldHdCharacter, direction: WorldHdDirection, action: WorldHdAction) {
 const facing = character.directions[direction];
 if (facing?.[action]) return { clip: facing[action], direction, action };
 if (facing?.idle) return { clip: facing.idle, direction, action: "idle" as const };
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

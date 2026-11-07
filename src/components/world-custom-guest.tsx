import { useEffect, useMemo, useRef, useState, type CSSProperties } from "react";
import type { WorldCustomCharacter } from "@/lib/world-custom-packs";
import { guestWanderPose } from "@/lib/world-guest-packs";
import { useCalmInterval, lowPower, useTabHidden } from "@/lib/power";
import { useReducedMotion } from "@/lib/reduced-motion";
import { advanceMotionClock } from "@/lib/pal-motion";
import type { CharacterMode } from "@/lib/hellraiser";
import { worldReactionFrame } from "@/lib/world-animation";
import { worldCueReaction, type WorldRoomCue } from "@/lib/world-character-packs";
import { spriteRuns } from "@/lib/sprite-upscale";
import { selectWorldHdClip, worldHdAction, worldHdFrameAt } from "@/lib/world-hd-animation";
import { worldDepthScale, worldDepthZ } from "@/lib/world-floor";
import { WORLD_GAITS, worldGaitOf, worldStepFrame } from "@/lib/world-wander";
import { clearWorldPresence, publishWorldPresence, useWorldFixtureUse, worldGreeting, worldPresenceSnapshot } from "@/lib/world-presence";
import { worldMotionFor } from "./world-guest";

/** Cosmetic animation only, using the existing obstacle-aware room route. */
export function WorldCustomGuest({ character, index, theme, active, cue, paused = false }: {
 character: WorldCustomCharacter; index: number; theme: CharacterMode; active: boolean; cue?: WorldRoomCue; paused?: boolean;
}) {
 const [{elapsed, routeElapsed}, setClock] = useState({elapsed:0, routeElapsed:0});
 const [gesture, setGesture] = useState<{ action: "wave" | "signature"; start: number; duration: number } | null>(null);
 const previous = useRef(0);
 const reduced = useReducedMotion(), low = lowPower.use(), hidden = useTabHidden();
 const animate = active && !paused && !reduced && !low && !hidden;
 useEffect(() => { previous.current = performance.now(); }, [animate]);
 useCalmInterval(() => {
  const now = performance.now();
  const delta = now - previous.current;
  previous.current = now;
  setClock(clock => {
   const next = advanceMotionClock(clock.elapsed, delta);
   const step = next - clock.elapsed;
   const held = gesture ? Math.max(0, Math.min(step, gesture.start + gesture.duration - clock.elapsed)) : 0;
   return {elapsed:next, routeElapsed:clock.routeElapsed + (step - held)};
  });
 }, 50, animate);
 const gait = worldGaitOf(character.hd3?.movement), actor = "custom:" + character.id;
 // Keep the last route position while paused instead of returning to the start. Custom guests start after the built-in spots.
 const pose = guestWanderPose(character.id, index + 8, theme, routeElapsed, gait);
 const gestureActive = gesture !== null && elapsed - gesture.start < gesture.duration;
 const standing = !gestureActive && pose.dwelling && (pose.action === "idle" || pose.action === "look");
 useEffect(() => { publishWorldPresence({ id: actor, x: pose.x, y: pose.y, dwelling: animate && standing, at: Date.now() }); }, [actor, pose.x, pose.y, animate, standing, elapsed]);
 useEffect(() => () => clearWorldPresence(actor), [actor]);
 const greeting = animate && standing ? worldGreeting({ id: actor, x: pose.x, y: pose.y, dwelling: true, at: Date.now() }, worldPresenceSnapshot(), Date.now()) : null;
 useWorldFixtureUse(actor, theme, animate && !gestureActive && pose.action === "interaction" ? pose.fixture : null);
 const reaction = worldCueReaction(cue, character.id, Date.now(), paused || reduced || low || hidden);
 const routeAction = greeting ? "talk" : pose.action;
 const facing = greeting && !gestureActive ? greeting.facing : pose.facing;
 const fallbackAction = gestureActive && gesture.action === "wave" ? "wave" : routeAction;
 const action = gestureActive ? gesture.action : reaction?.action ?? fallbackAction;
 const walking = !gestureActive && !reaction && worldHdAction(fallbackAction) === "walk";
 const step = walking ? worldStepFrame(pose, gait) : Math.floor(elapsed / 175) % 4;
 const motion = worldMotionFor(fallbackAction);
 const runs = useMemo(() => character.hd || character.hd3 ? [] : spriteRuns(
  worldReactionFrame(character.pixels, facing, reaction, motion, step),
  (x, y) => y < 24 ? "body" : x < 16 ? "left-leg" : "right-leg"
 ), [character.pixels, character.hd, character.hd3, facing, reaction, motion, step]);
 const kind = worldHdAction(action);
 const art = character.hd;
 const frames = art ? (kind === "wave" ? art.wave : kind === "celebrate" ? art.celebrate : kind === "walk" ? art.walk : art.idle) ?? art.idle : undefined;
 const selected = character.hd3 ? selectWorldHdClip(character.hd3, facing, kind) : undefined;
 const clipKey = `${character.id}:${character.hd3?.version}:${selected?.direction}:${selected?.action}:${gestureActive ? gesture?.start : "route"}`;
 const [clipClock, setClipClock] = useState({ key: clipKey, start: elapsed });
 if (clipClock.key !== clipKey) setClipClock({ key: clipKey, start: elapsed });
 // Walk clips follow distance travelled (authored durations = cruising speed) so feet don't slide while easing.
 const clipElapsed = walking && selected?.action === "walk" ? pose.travelled / WORLD_GAITS[gait].speed * 1000 :
  clipClock.key === clipKey ? elapsed - clipClock.start : 0;
 const image = selected ? worldHdFrameAt(selected.clip, clipElapsed) : frames?.[Math.floor(elapsed / 175) % frames.length];
 const style = { "--world-guest-x": pose.x + "%", "--world-guest-y": pose.y + "%", "--world-z": String(worldDepthZ(pose.y)), "--world-depth-scale": String(worldDepthScale(pose.y)) } as CSSProperties;
 const signature = !!character.hd3 && Object.values(character.hd3.directions).some(actions => actions?.signature);
 const trigger = (action: "wave" | "signature") => {
  if (!animate) return;
  const clip = character.hd3 ? selectWorldHdClip(character.hd3, facing, action).clip : undefined;
  // Hold a static pose long enough to read it; never truncate supplied animation.
  const duration = Math.max(1700, clip?.frames.reduce((sum, frame) => sum + frame.durationMs, 0) ?? 0);
  setGesture({ action, start: elapsed, duration });
 };
 useEffect(() => {
  const receive = (event: Event) => {
   const detail = (event as CustomEvent<unknown>).detail;
   if (animate && signature && detail && typeof detail === "object" && "id" in detail && "action" in detail && detail.id === character.id && detail.action === "signature") trigger("signature");
  };
  window.addEventListener("pixel-pals:hd-action", receive);
  return () => window.removeEventListener("pixel-pals:hd-action", receive);
 }, [animate, signature, character.id, character.hd3, facing, elapsed]);
 return <div className="world-guest world-custom-guest" style={style} data-action={action} data-facing={selected?.direction ?? facing} data-movement={gait} data-paused={!animate}>
  <button type="button" className="world-custom-actor" aria-label={"Wave to " + character.name}
   title={signature ? "Tap to wave. Shift-click or press S for signature action." : "Tap to wave"}
   onClick={event => trigger(signature && event.shiftKey ? "signature" : "wave")}
   onKeyDown={event => { if (signature && event.key.toLowerCase() === "s") { event.preventDefault(); trigger("signature"); } }}>
   {image ? <img className="world-guest-pixels world-guest-hd-pixels" src={image} width={256} height={256} draggable={false} alt={character.name + " 256 pixel character"}/> :
    <svg viewBox="0 0 32 32" className="world-guest-pixels" role="img" shapeRendering="crispEdges" aria-label={character.name + " custom pixel character"}>
     {runs.map(run => <rect key={run.x + "-" + run.y} x={run.x} y={run.y} width={run.w} height="1" fill={character.palette[run.c] ?? "transparent"}/>)}
    </svg>}
   <span className="world-guest-name">{character.name}</span>
   {animate && (action === "wave" || action === "celebrate" || action === "signature") && <span className="world-guest-spark" aria-hidden="true">✦</span>}
  {animate && action === "talk" && <span className="world-guest-chat" aria-hidden="true">…</span>}
  </button>
  {signature && <button type="button" className="world-signature-button" aria-label={"Signature action for " + character.name} disabled={!animate} onClick={() => trigger("signature")}>✦</button>}
 </div>;
}

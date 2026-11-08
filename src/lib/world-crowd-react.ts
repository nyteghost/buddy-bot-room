import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { CharacterMode } from "./hellraiser";
import type { Heading } from "./office-motion";
import { worldCrowd, worldCrowdFootprint, worldCrowdPhone, type WorldCrowdMember, type WorldCrowdPlan } from "./world-crowd";

/** React binding for the Living World crowd (engine in world-crowd.ts stays framework-free). */
type Mutable<T> = { current: T };
/**
 * Join this room's crowd while `member` is set (a moving actor with a route), or stand in it as a fixed obstacle
 * at `fixedAt`. Returns the crowd pose (null before the first effect) and an `advance` to call from the
 * component's existing motion timer.
 */
export function useWorldCrowd({ theme, member, time, active, fixedAt }: {
 theme: CharacterMode;
 member: (Omit<WorldCrowdMember, "plan" | "rx" | "ry"> & { plan?: WorldCrowdPlan; scale?: number }) | null;
 /** Route time to join at. */ time: number;
 /** Animating (false: Focus Mode, reduced motion, low power, hidden tab). */ active: boolean;
 fixedAt?: { x: number; y: number; facing?: Heading } | null;
}) {
 const crowd = worldCrowd(theme);
 const planRef = useRef<WorldCrowdPlan | undefined>(member?.plan) as Mutable<WorldCrowdPlan | undefined>;
 planRef.current = member?.plan;
 const id = member?.id ?? "", moving = !!member?.plan, scale = member?.scale ?? 1, priority = member?.priority ?? 0, speed = member?.speed ?? 5;
 const timeRef = useRef(time); timeRef.current = time;
 const [, setVersion] = useState(0);
 const built = useMemo<WorldCrowdMember | null>(() => !id ? null : ({
  id, priority, speed, ...worldCrowdFootprint(scale, worldCrowdPhone()),
  ...(moving ? { plan: (t: number) => planRef.current!(t) } : {}),
 }), [id, priority, speed, scale, moving]);
 useEffect(() => {
  if (!built) return;
  const now = performance.now();
  if (built.plan) crowd.join(built, timeRef.current, now); else if (fixedAt) crowd.place(built, fixedAt.x, fixedAt.y, now, fixedAt.facing);
  setVersion(v => v + 1);
  return () => crowd.leave(built.id);
 }, [crowd, built]); // eslint-disable-line react-hooks/exhaustive-deps
 // Fixed obstacles follow their externally driven position.
 const fx = fixedAt?.x, fy = fixedAt?.y, ff = fixedAt?.facing;
 useEffect(() => { if (built && !built.plan && fx !== undefined && fy !== undefined) crowd.place(built, fx, fy, performance.now(), ff); }, [crowd, built, fx, fy, ff]);
 useEffect(() => { if (built?.plan) crowd.setPaused(built.id, !active, performance.now()); }, [crowd, built, active]);
 const advance = useCallback((delta: number) => { if (built?.plan && crowd.has(built.id)) crowd.advance(built.id, delta, performance.now()); }, [crowd, built]);
 return { pose: built?.plan && crowd.has(built.id) ? crowd.pose(built.id) : null, advance };
}

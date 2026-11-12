import { Component, useEffect, useMemo, useRef, useState, type CSSProperties, type ErrorInfo, type ReactNode } from "react";
import type { WorldCustomCharacter } from "@/lib/world-custom-packs";
import type { WorldCamera, WorldSize } from "@/lib/world-camera";
import { worldCameraTransform } from "@/lib/world-camera";
import { useReducedMotion } from "@/lib/reduced-motion";
import { lowPower, useTabHidden } from "@/lib/power";
import { WORLD_ISO_FACING_ANGLES } from "@/lib/world-iso-facing";
import { WORLD_ISO_CANVAS } from "@/lib/world-iso-projection";
import { WORLD_ISO_GREYBOX } from "@/lib/world-iso-greybox";
import { WorldIsoCrowd, type WorldIsoCrowdPose, type WorldIsoCrowdDiagnostics } from "@/lib/world-iso-crowd";
import { WORLD_ISO_SCHEDULE_PERIOD_MS, worldIsoSchedule, type WorldIsoScheduledActor } from "@/lib/world-iso-schedule";
import { worldIsoSceneFrame } from "@/lib/world-iso-scene";
import { WorldIsoClock } from "@/lib/world-iso-clock";
import type { HdOfficePal } from "./world-hd-office";

/**
 * Isolated, unmounted grey-box. Stage 4 owns the actual flat-Office fallback
 * element and shared WorldCamera. Neither is created or mounted here.
 */
export type WorldIsoOfficeProps = Readonly<{
 pals: readonly HdOfficePal[]; visitors: readonly WorldCustomCharacter[];
 visible: boolean; playful: boolean; paused: boolean; synthetic: boolean;
 camera?: WorldCamera; viewport?: WorldSize; fallback?: ReactNode;
 /** Optional diagnostic notification. Called once after an asynchronous fault. */
 onFailure?: (reason: string) => void;
 /** Bounded progress/blocked-route telemetry; does not grant any app permissions. */
 onDiagnostics?: (report: WorldIsoCrowdDiagnostics) => void;
}>;
// Entry order is deterministic and independent of incumbent positions/routes.
// A temporary occupied home is not a scene fault. Only join() may admit an actor.
function joinAtAvailableHome(crowd: WorldIsoCrowd, actor: WorldIsoScheduledActor): boolean {
 const homes = WORLD_ISO_GREYBOX.anchors.filter(a => a.kind === (actor.kind === "pal" ? "seat" : "visitor"))
  .sort((a, b) => Number(b.id === actor.home) - Number(a.id === actor.home) || a.id.localeCompare(b.id));
 return homes.some(home => crowd.join({ id: actor.id, kind: actor.kind, at: home.at,
  facing: home.facing, real: !!actor.real }));
}
const pointString = (poly: readonly { x: number; y: number }[]) => poly.map(p => p.x + "," + p.y).join(" ");
const label = (s: string) => s.length > 30 ? s.slice(0, 30) + "…" : s;
const FALLBACK_MESSAGE = "Isometric preview unavailable. The existing flat HD Office remains available.";

class PreviewBoundary extends Component<{ fallback?: ReactNode; children: ReactNode }, { failed: boolean }> {
 override state = { failed: false };
 static getDerivedStateFromError(): { failed: boolean } { return { failed: true }; }
 override componentDidCatch(_error: Error, _info: ErrorInfo): void {
  // The boundary isolates the visual preview; do not log user identities or scene payloads.
 }
 override render() {
  return this.state.failed
   ? <div role="alert" data-iso-fallback="true">{this.props.fallback ?? FALLBACK_MESSAGE}</div>
   : this.props.children;
 }
}

export function WorldIsoOffice(props: WorldIsoOfficeProps) {
 return <PreviewBoundary fallback={props.fallback}><WorldIsoOfficeInner {...props}/></PreviewBoundary>;
}

function WorldIsoOfficeInner({ pals, visitors, visible, playful, paused, synthetic: _synthetic,
 camera, viewport, fallback, onFailure, onDiagnostics }: WorldIsoOfficeProps) {
 const reduced = useReducedMotion(), low = lowPower.use(), hidden = useTabHidden();
 const moving = visible && playful && !paused && !reduced && !low && !hidden;
 // Stable semantic keys: existing room.tsx creates fresh but equivalent arrays on
 // every parent render. Neither the crowd nor the RAF clock must depend on their identities.
 const rosterKey = JSON.stringify([pals.map(p => [p.id, p.name, p.enabled, p.real]),
  visitors.map(v => [v.id, v.name])]);
 const latest = useRef({ pals, visitors, onFailure, onDiagnostics });
 latest.current = { pals, visitors, onFailure, onDiagnostics };
 const clock = useRef(new WorldIsoClock());
 const initial = useMemo(() => worldIsoSchedule(pals, visitors, clock.current.elapsedMs), [rosterKey]); // eslint-disable-line react-hooks/exhaustive-deps
 const rosterIds = initial.map(a => a.id).sort().join("|");
 const crowdRef = useRef<WorldIsoCrowd | null>(null);
 if (!crowdRef.current) crowdRef.current = new WorldIsoCrowd(WORLD_ISO_GREYBOX);
 const crowd = crowdRef.current;
 const [view, setView] = useState<readonly WorldIsoScheduledActor[]>(initial);
 const [poses, setPoses] = useState<WorldIsoCrowdPose[]>([]);
 const [fault, setFault] = useState<string | null>(null);
 const lastPeriod = useRef(-1);
 const nextJoinAt = useRef(0);
 const lastRosterKey = useRef("");
 const lastRender = useRef(0);
 const lastReportedFault = useRef<string | null>(null);
 // At most two route assignments/retries per animation update, regardless
 // of the number of actors whose ambient destinations changed together.
 const pending = useRef<{id: string; target: {u: number; v: number}; real: boolean; nextAt: number}[]>([]);
 const byId = useMemo(() => new Map(view.map(a => [a.id, a])), [view]);
 // Scene generation runs during render for the initial static preview. A null
 // or thrown frame is converted to a render-safe fault flag; its effect below
 // latches the failure. The RAF effect also watches this flag, so it cannot
 // start or continue while React is committing the fault.
 const sceneState = useMemo(() => {
  if (fault) return { scene: null, failed: false };
  try {
   const scene = worldIsoSceneFrame(WORLD_ISO_GREYBOX, poses.map(p => ({
    ...p, name: byId.get(p.id)?.name ?? p.id, real: byId.get(p.id)?.real ?? null,
   })));
   return { scene, failed: !scene };
  } catch { return { scene: null, failed: true }; }
 }, [fault, poses, byId]);
 const sceneFault = sceneState.failed ? "Isometric scene generation failed; simulation stopped." : null;
 useEffect(() => {
  if (sceneFault && !fault) setFault(sceneFault);
 }, [sceneFault, fault]);

 // Join/leave only on genuinely changed identities. Already-present Pals
 // retain exact positions, routes and accumulated gait distance.
 useEffect(() => {
  const nextIds = new Set(initial.map(a => a.id));
  for (const id of crowd.ids()) if (!nextIds.has(id)) crowd.leave(id);
  for (const a of initial) if (!crowd.pose(a.id)) joinAtAvailableHome(crowd, a);
  nextJoinAt.current = clock.current.elapsedMs + 2_000;
  lastRosterKey.current = "";
  setView(initial); setPoses(crowd.snapshot());
 }, [crowd, rosterIds]); // eslint-disable-line react-hooks/exhaustive-deps

 // On an actual work-state/name change, refresh labels and targets without
 // recreating the actor crowd or resetting elapsed time.
 useEffect(() => { lastRosterKey.current = ""; setView(initial); }, [rosterKey]); // eslint-disable-line react-hooks/exhaustive-deps

 useEffect(() => {
  if (!moving || fault || sceneFault) {
   crowd.step(0, true);
   setPoses(crowd.snapshot());
   return;
  }
  let raf = 0, last = performance.now(), stopped = false;
  const frame = (now: number) => {
   if (stopped) return;
   try {
    const elapsed = clock.current.advance(Math.max(0, now - last));
    last = now;
    const source = latest.current;
    const period = Math.floor(elapsed / WORLD_ISO_SCHEDULE_PERIOD_MS);
    if (lastPeriod.current !== period || lastRosterKey.current !== rosterKey) {
     const targets = worldIsoSchedule(source.pals, source.visitors, elapsed);
     for (const target of targets) crowd.setReal(target.id,!!target.real);
     crowd.beginSchedulePeriod();
     pending.current = targets.map(a => ({id:a.id, target:a.target, real:!!a.real, nextAt:elapsed}));
     setView(targets);
     lastPeriod.current = period; lastRosterKey.current = rosterKey;
    }
    // Retry missing roster members without resetting incumbent routes or the
    // schedule period. Paused/hidden previews retry when motion resumes.
    if (elapsed >= nextJoinAt.current) {
     for (const actor of worldIsoSchedule(source.pals, source.visitors, elapsed)) {
      if (!crowd.pose(actor.id) && joinAtAvailableHome(crowd, actor)) {
       const request = pending.current.find(p => p.id === actor.id);
       if (request) request.nextAt = elapsed;
       else pending.current.push({id:actor.id, target:actor.target, real:!!actor.real, nextAt:elapsed});
      }
     }
     nextJoinAt.current = elapsed + 2_000;
    }
    let assignments = 0;
    for(let i=0;i<pending.current.length && assignments<2;) {
     const request=pending.current[i]!;
     if(elapsed<request.nextAt || !crowd.pose(request.id)){i++;continue;}
     crowd.setReal(request.id,request.real);
     assignments++;
     if(crowd.assign(request.id,request.target)) pending.current.splice(i,1);
     else {
      request.nextAt=elapsed+2_000;
      try { source.onDiagnostics?.(crowd.diagnostics()); } catch { /* telemetry is optional */ }
      i++;
     }
    }
    // Advance only the capped elapsed time. Suspended-tab time is deliberately
    // discarded by WorldIsoClock; do not simulate a catch-up burst on resume.
    crowd.step(clock.current.lastAdvanceMs);
    if (!crowd.valid()) throw new Error("Actor clearance violated.");
    if (now - lastRender.current >= 100) {
     lastRender.current = now; setPoses(crowd.snapshot());
    }
    raf = requestAnimationFrame(frame);
   } catch {
    setFault("The isolated isometric simulation stopped safely.");
   }
  };
  raf = requestAnimationFrame(frame);
  return () => { stopped = true; cancelAnimationFrame(raf); };
 }, [moving, crowd, fault, sceneFault, rosterKey]);

 useEffect(() => {
  if (fault && lastReportedFault.current !== fault) {
   lastReportedFault.current = fault;
   latest.current.onFailure?.(fault);
  }
 }, [fault]);
 if (!sceneState.scene) return <div role="alert" data-iso-fallback="true">{fallback ?? FALLBACK_MESSAGE}</div>;
 const scene = sceneState.scene;
 const transforms: CSSProperties | undefined = camera ? {
  transform: worldCameraTransform(camera, viewport ?? WORLD_ISO_CANVAS), transformOrigin: "0 0",
 } : undefined;
 const props = new Map(scene.props.map(p => ["prop:" + p.id, p]));
 const actors = new Map(scene.actors.map(a => [a.id, a]));
 return <div data-iso-preview="isolated" data-running={moving} aria-label="Isometric Office synthetic preview"
  style={{ position: "relative", width: "100%" }}>
  <svg role="img" aria-label="Synthetic isometric Office floor with nine Pal desks and six visitor homes"
   viewBox={"0 0 " + scene.width + " " + scene.height} data-testid="iso-preview-svg"
   style={{ display: "block", width: "100%", height: "auto", background: "#171c30" }}>
   <g style={transforms}>
    <polygon data-testid="iso-preview-floor" points={pointString(scene.floor)} fill="#38425d" stroke="#8b9bc1" strokeWidth="5" />
    {scene.grid.map((line, i) => <line key={i} x1={line[0].x} y1={line[0].y}
     x2={line[1].x} y2={line[1].y} stroke="#667596" opacity="0.42" strokeWidth="2" />)}
    {scene.order.order.map(id => {
     const p = props.get(id);
     if (p) return <polygon key={id} data-iso-prop={p.id} points={pointString(p.diamond)}
      fill={p.id.startsWith("desk") ? "#65577b" : "#465b69"} stroke="#c0b4d8" strokeWidth="5" />;
     const a = actors.get(id);
     if (!a) return null;
     const angle = WORLD_ISO_FACING_ANGLES[a.facing] * Math.PI / 180;
     const fill = a.kind === "pal" ? "#6ad4eb" : "#f4bb69";
     return <g key={id} data-iso-actor={a.id} data-iso-real={a.real ?? undefined} data-facing={a.facing}
      data-status={poses.find(pose => pose.id === id)?.status}>
      <circle cx={a.feet.x} cy={a.feet.y} r="20" fill={fill} stroke="#111827" strokeWidth="5" />
      <line x1={a.feet.x} y1={a.feet.y} x2={a.feet.x + Math.cos(angle) * 38}
       y2={a.feet.y + Math.sin(angle) * 38} stroke="#fff" strokeWidth="7" strokeLinecap="round" />
      <text x={a.feet.x} y={a.feet.y - 28} textAnchor="middle" fontSize="26" fontWeight="600" fill="#fff">{label(a.name)}</text>
      {a.real && <circle cx={a.feet.x + 21} cy={a.feet.y - 21} r="9" fill="#49eb91" />}
     </g>;
    })}
   </g>
  </svg>
  <span style={{ position: "absolute", top: 8, left: 8, fontSize: 12, color: "white",
   background: "#111827dc", padding: "4px 8px", borderRadius: 6 }}>
   Isometric grey-box prototype · Not production art
  </span>
  <ul className="sr-only" aria-label="Preview actors">
   {view.map(a => <li key={a.id}>{a.name}: {a.real ? "Real activity — " + a.real : "Ambient display only, not a real task"}</li>)}
  </ul>
 </div>;
}

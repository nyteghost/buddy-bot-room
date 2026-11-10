import { useEffect, useMemo, useState, type CSSProperties, type ReactNode } from "react";
import type { WorldCustomCharacter } from "@/lib/world-custom-packs";
import type { WorldCamera, WorldSize } from "@/lib/world-camera";
import { worldCameraTransform } from "@/lib/world-camera";
import { useReducedMotion } from "@/lib/reduced-motion";
import { lowPower, useTabHidden } from "@/lib/power";
import { WORLD_ISO_FACING_ANGLES } from "@/lib/world-iso-facing";
import { WORLD_ISO_CANVAS } from "@/lib/world-iso-projection";
import { WORLD_ISO_GREYBOX } from "@/lib/world-iso-greybox";
import { WorldIsoCrowd, type WorldIsoCrowdPose } from "@/lib/world-iso-crowd";
import { worldIsoSchedule, type WorldIsoScheduledActor } from "@/lib/world-iso-schedule";
import { worldIsoSceneFrame } from "@/lib/world-iso-scene";
import type { HdOfficePal } from "./world-hd-office";

/**
 * Stage 1b nonmounted grey-box preview. No production assets, no app-state authority,
 * no storage or permission access. The Pal Room has no import of this component.
 * Stage 4 must provide a real fallback boundary and reuse its owner camera instance.
 */
export type WorldIsoOfficeProps = Readonly<{
 pals: readonly HdOfficePal[];
 visitors: readonly WorldCustomCharacter[];
 visible: boolean; playful: boolean; paused: boolean; synthetic: boolean;
 camera?: WorldCamera;
 viewport?: WorldSize;
 fallback?: ReactNode;
}>;

const pointString = (poly: readonly { x: number; y: number }[]) => poly.map(p => p.x + "," + p.y).join(" ");
const empty: WorldIsoCrowdPose[] = [];
const label = (s: string) => s.length > 30 ? s.slice(0, 30) + "…" : s;

export function WorldIsoOffice({ pals, visitors, visible, playful, paused, synthetic: _synthetic, camera, viewport, fallback }: WorldIsoOfficeProps) {
 const reduced = useReducedMotion(), low = lowPower.use(), hidden = useTabHidden();
 const moving = visible && playful && !paused && !reduced && !low && !hidden;
 const rosterKey = JSON.stringify([pals.map(p => [p.id, p.name, p.enabled, p.real]), visitors.slice(0, 6).map(v => [v.id, v.name])]);
 const scheduled = useMemo(() => worldIsoSchedule(pals, visitors, 0), [rosterKey]); // eslint-disable-line react-hooks/exhaustive-deps
 const crowd = useMemo(() => {
  const sim = new WorldIsoCrowd(WORLD_ISO_GREYBOX);
  for (const a of scheduled) {
   const at = WORLD_ISO_GREYBOX.anchors.find(x => x.id === a.home);
   if (at && !sim.join({ id: a.id, kind: a.kind, at: at.at, facing: at.facing }))
    throw new Error("Preview actor could not be placed without collision.");
  }
  return sim;
 }, [scheduled]);
 const [poses, setPoses] = useState<WorldIsoCrowdPose[]>(empty);
 const [fault, setFault] = useState(false);
 useEffect(() => { setPoses(crowd.snapshot()); setFault(false); }, [crowd]);

 useEffect(() => {
  if (!moving || fault) { crowd.step(0, true); setPoses(crowd.snapshot()); return; }
  let raf = 0, elapsed = 0, last = performance.now(), renderedAt = last, disposed = false;
  const frame = (now: number) => {
   if (disposed) return;
   try {
    const dt = Math.max(0, Math.min(100, now - last)); last = now; elapsed += dt;
    const targets = worldIsoSchedule(pals, visitors, elapsed);
    for (const a of targets) crowd.assign(a.id, a.target);
    crowd.step(dt);
    if (!crowd.valid()) throw new Error("Actor clearance violated.");
    if (now - renderedAt >= 80) { renderedAt = now; setPoses(crowd.snapshot()); }
    raf = requestAnimationFrame(frame);
   } catch {
    setFault(true); // asynchronous failures cannot be caught by a React render boundary
   }
  };
  raf = requestAnimationFrame(frame);
  return () => { disposed = true; cancelAnimationFrame(raf); };
 }, [moving, crowd, fault, pals, visitors]);

 const byId = useMemo(() => new Map<string, WorldIsoScheduledActor>(scheduled.map(a => [a.id, a])), [scheduled]);
 let scene;
 try {
  scene = fault ? null : worldIsoSceneFrame(WORLD_ISO_GREYBOX, poses.map(p => ({
   ...p, name: byId.get(p.id)?.name ?? p.id, real: byId.get(p.id)?.real ?? null,
  })));
 } catch {
  scene = null;
 }
 if (!scene) return <div role="status" data-iso-fallback="true">{fallback ?? "Isometric preview unavailable; use the existing flat HD Office."}</div>;

 const transforms: CSSProperties | undefined = camera ? {
  transform: worldCameraTransform(camera, viewport ?? WORLD_ISO_CANVAS),
  transformOrigin: "0 0",
 } : undefined;
 const props = new Map(scene.props.map(p => ["prop:" + p.id, p]));
 const actors = new Map(scene.actors.map(a => [a.id, a]));

 return <div data-iso-preview="isolated" data-running={moving} aria-label="Isometric Office synthetic preview" style={{ position: "relative", width: "100%" }}>
  <svg role="img" aria-label="Synthetic isometric Office floor with nine Pal desks and six visitor homes" viewBox={`0 0 ${scene.width} ${scene.height}`}
   data-testid="iso-preview-svg" style={{ display: "block", width: "100%", height: "auto", background: "#171c30" }}>
   <g style={transforms}>
    <polygon data-testid="iso-preview-floor" points={pointString(scene.floor)} fill="#38425d" stroke="#8b9bc1" strokeWidth="5" />
    {scene.grid.map((line, i) => <line key={i} x1={line[0].x} y1={line[0].y} x2={line[1].x} y2={line[1].y} stroke="#667596" opacity="0.42" strokeWidth="2" />)}
    {scene.order.order.map(id => {
     const p = props.get(id);
     if (p) return <polygon key={id} data-iso-prop={p.id} points={pointString(p.diamond)}
      fill={p.id.startsWith("desk") ? "#65577b" : "#465b69"} stroke="#c0b4d8" strokeWidth="5" />;
     const a = actors.get(id);
     if (!a) return null;
     const angle = WORLD_ISO_FACING_ANGLES[a.facing] * Math.PI / 180;
     const fill = a.kind === "pal" ? "#6ad4eb" : "#f4bb69";
     return <g key={id} data-iso-actor={a.id} data-iso-real={a.real ?? undefined} data-facing={a.facing}>
      <circle cx={a.feet.x} cy={a.feet.y} r="20" fill={fill} stroke="#111827" strokeWidth="5" />
      <line x1={a.feet.x} y1={a.feet.y} x2={a.feet.x + Math.cos(angle) * 38} y2={a.feet.y + Math.sin(angle) * 38}
       stroke="#fff" strokeWidth="7" strokeLinecap="round" />
      <text x={a.feet.x} y={a.feet.y - 28} textAnchor="middle" fontSize="26" fontWeight="600" fill="#fff">{label(a.name)}</text>
      {a.real && <circle cx={a.feet.x + 21} cy={a.feet.y - 21} r="9" fill="#49eb91" />}
     </g>;
    })}
   </g>
  </svg>
  <span style={{ position: "absolute", top: 8, left: 8, fontSize: 12, color: "white", background: "#111827dc", padding: "4px 8px", borderRadius: 6 }}>
   Isometric grey-box prototype · Not production art
  </span>
  <ul className="sr-only" aria-label="Preview actors">
   {scheduled.map(a => <li key={a.id}>{a.name}: {a.real ? `Real activity — ${a.real}` : "Ambient display only, not a real task"}</li>)}
  </ul>
 </div>;
}

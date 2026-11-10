import { Component, useEffect, useMemo, useRef, useState, type CSSProperties, type ReactNode } from "react";
import { WORLD_ISO_FACING_ANGLES } from "@/lib/world-iso-facing";
import type { ScreenPoint } from "@/lib/world-iso-projection";
import type { WorldIsoScene } from "@/lib/world-iso-scene";
import { createWorldIsoStage, type WorldIsoStage, type WorldIsoStageActor, type WorldIsoStageFrame } from "@/lib/world-iso-stage";

/**
 * Living Universe — Isometric Office preview (Step 1b, Stage 3): standalone grey-box preview component.
 *
 * NOT MOUNTED ANYWHERE. Nothing in the app imports this file (a test enforces that). It exists so the
 * isometric engine can be exercised and reviewed in isolation; mounting it is Stage 4, which is not authorized.
 *
 * What it draws: the synthetic 19 × 14 floor on the 2:1 grid, grey blocks for furniture, markers for the nine
 * workstations and six visitor homes, and one marker per character with a wedge showing its facing. It uses
 * no artwork and no global CSS (inline styles only), and it reads or writes no storage.
 *
 * Explicit interfaces instead of app internals:
 * - `pals` / `visitors`: ids, names and workstation numbers from the caller. `real` is the app's own
 *   real-activity text for a Pal, or null. Only a Pal with `real` is ever labelled as doing real work.
 * - `presentation`: visible / paused / reducedMotion / lowPower, decided by the caller.
 * - `camera`: world-pixel offset and zoom, decided by the caller (the existing camera maths can drive it).
 * - `renderActor`: optional hook to draw real character art (for example HD256) instead of the placeholder.
 * - `fallback`: what to show instead if the plan is invalid or drawing fails (for example the flat HD office).
 * - `controller`: lets a test or host step time by hand instead of using animation frames.
 *
 * Per frame it moves existing elements directly (transform, z-index, two data attributes) and re-renders
 * React only when the list of who-is-doing-what text changes.
 */
export type WorldIsoOfficePal = Readonly<{ id: string; name: string; /** Workstation number 0–8 (same order as today's desks). */ desk: number; /** The app's real-activity text, or null. */ real: string | null; sits?: boolean }>;
export type WorldIsoOfficeVisitor = Readonly<{ id: string; name: string }>;
export type WorldIsoOfficePresentation = Readonly<{ visible: boolean; paused: boolean; reducedMotion: boolean; lowPower: boolean }>;
export type WorldIsoOfficeCamera = Readonly<{ /** World px shown at the top-left corner. */ x: number; y: number; zoom: number }>;
export type WorldIsoOfficeController = Readonly<{ /** Move the room forward by `ms` and redraw. */ advance(ms: number): void; frame(): WorldIsoStageFrame }>;
export type WorldIsoOfficeProps = Readonly<{
 pals: readonly WorldIsoOfficePal[];
 visitors: readonly WorldIsoOfficeVisitor[];
 presentation: WorldIsoOfficePresentation;
 fallback: ReactNode;
 camera?: WorldIsoOfficeCamera;
 /** Raw ground plan; defaults to the synthetic grey-box Office. It is validated before anything is drawn. */ plan?: unknown;
 seed?: string;
 renderActor?: (actor: WorldIsoStageActor) => ReactNode;
 controller?: (controller: WorldIsoOfficeController | null) => void;
 onFallback?: (reason: "invalid-plan" | "error") => void;
}>;

const ACTOR_HEIGHT = 165; // world px: a standing HD256 character at the approved scale
const points = (ps: readonly ScreenPoint[]) => ps.map(p => `${p.x},${p.y}`).join(" ");
const still = (p: WorldIsoOfficePresentation) => p.paused || p.reducedMotion || p.lowPower || !p.visible;
const finiteCamera = (c: WorldIsoOfficeCamera | undefined): WorldIsoOfficeCamera =>
 c && Number.isFinite(c.x) && Number.isFinite(c.y) && Number.isFinite(c.zoom) && c.zoom > 0 ? { x: c.x, y: c.y, zoom: Math.min(4, Math.max(0.05, c.zoom)) } : { x: 0, y: 0, zoom: 1 };

/** Shown instead of the preview when it cannot run. */
function Fallback({ reason, children }: { reason: "invalid-plan" | "error"; children: ReactNode }) {
 return <div data-iso-office-fallback={reason}>
  <p role="status" style={{ margin: 0, padding: "4px 8px", font: "12px system-ui, sans-serif" }}>Isometric preview unavailable. Showing the current Office.</p>
  {children}
 </div>;
}
class Boundary extends Component<{ fallback: ReactNode; onFallback?: (reason: "invalid-plan" | "error") => void; children: ReactNode }, { failed: boolean }> {
 override state = { failed: false };
 static getDerivedStateFromError() { return { failed: true }; }
 override componentDidCatch() { this.props.onFallback?.("error"); }
 override render() { return this.state.failed ? <Fallback reason="error">{this.props.fallback}</Fallback> : this.props.children; }
}

/** Placeholder character: a ground shadow, a facing wedge and a simple body. No artwork. */
function Placeholder({ actor }: { actor: WorldIsoStageActor }) {
 const pal = actor.kind === "pal", angle = WORLD_ISO_FACING_ANGLES[actor.facing];
 return <svg width="120" height={ACTOR_HEIGHT + 30} viewBox={`-60 ${-ACTOR_HEIGHT} 120 ${ACTOR_HEIGHT + 30}`} style={{ position: "absolute", left: -60, top: -ACTOR_HEIGHT, overflow: "visible" }} aria-hidden="true">
  <ellipse cx="0" cy="0" rx="26" ry="13" fill="rgba(0,0,0,0.28)" />
  <polygon data-iso-wedge="" points="34,0 12,-9 12,9" transform={`rotate(${angle})`} fill={pal ? "#f5c542" : "#9ad1ff"} stroke="#1c2030" strokeWidth="1.5" />
  <rect x="-22" y={-ACTOR_HEIGHT + 44} width="44" height={ACTOR_HEIGHT - 48} rx="20" fill={pal ? "#7a6bd6" : "#5b8fa8"} stroke="#1c2030" strokeWidth="2" />
  <circle cx="0" cy={-ACTOR_HEIGHT + 26} r="24" fill={pal ? "#c9c2f2" : "#bcdcea"} stroke="#1c2030" strokeWidth="2" />
 </svg>;
}

/** Floor, grid, walls and anchor markers: drawn once per scene. */
function StaticLayer({ scene }: { scene: WorldIsoScene }) {
 return <svg data-iso-floor="" width={scene.canvas.width} height={scene.canvas.height} style={{ position: "absolute", left: 0, top: 0, zIndex: 0 }} aria-hidden="true">
  {scene.walls.map((w, i) => <polygon key={`wall-${i}`} points={points(w)} fill="#2b3047" stroke="#454c6b" strokeWidth="2" />)}
  <polygon points={points(scene.floor)} fill="#3a4160" stroke="#59628a" strokeWidth="3" />
  {scene.grid.map(([a, b], i) => <line key={`grid-${i}`} x1={a.x} y1={a.y} x2={b.x} y2={b.y} stroke="#4a5278" strokeWidth="1" />)}
  {scene.markers.filter(m => m.kind === "seat" || m.kind === "visitor" || m.kind === "door").map(m => <g key={m.id} data-iso-marker={m.id} data-kind={m.kind}>
   <ellipse cx={m.screen.x} cy={m.screen.y} rx="30" ry="15" fill="none" stroke={m.kind === "seat" ? "#f5c542" : m.kind === "visitor" ? "#9ad1ff" : "#ffffff"} strokeWidth="2" strokeDasharray={m.kind === "door" ? "6 4" : undefined} />
   <polygon points={points(m.wedge)} fill={m.kind === "seat" ? "#f5c542" : m.kind === "visitor" ? "#9ad1ff" : "#ffffff"} opacity="0.55" />
   <text x={m.screen.x} y={m.screen.y + 5} textAnchor="middle" fontSize="14" fontFamily="system-ui, sans-serif" fill="#e8ebf7">{m.kind === "seat" ? String((m.desk ?? 0) + 1) : m.kind === "visitor" ? "V" : "Door"}</text>
  </g>)}
 </svg>;
}

const worldStyle = (scene: WorldIsoScene, camera: WorldIsoOfficeCamera): CSSProperties => ({
 position: "absolute", left: 0, top: 0, width: scene.canvas.width, height: scene.canvas.height, transformOrigin: "0 0",
 transform: `translate(${-camera.x * camera.zoom}px, ${-camera.y * camera.zoom}px) scale(${camera.zoom})`,
});
const describe = (frame: WorldIsoStageFrame, real: ReadonlyMap<string, string | null>) =>
 frame.actors.map(a => a.real ? `${a.name}: ${real.get(a.id) ?? "active"} (real activity)` : `${a.name}: ${a.ambient ?? "here"} (ambient animation, not real work)`);

type RoomProps = Readonly<{
 stage: WorldIsoStage; pals: readonly WorldIsoOfficePal[]; presentation: WorldIsoOfficePresentation; camera: WorldIsoOfficeCamera | undefined;
 renderActor: ((actor: WorldIsoStageActor) => ReactNode) | undefined; controller: ((controller: WorldIsoOfficeController | null) => void) | undefined;
}>;
function Room({ stage, pals, presentation, camera, renderActor, controller }: RoomProps) {
 const scene = stage.scene, cam = finiteCamera(camera);
 const realText = useMemo(() => new Map(pals.map(p => [p.id, p.real])), [pals]);
 const elements = useRef(new Map<string, HTMLElement | SVGElement>());
 const drawn = useRef(new Map<string, string>());
 const [lines, setLines] = useState<readonly string[]>(() => describe(stage.frame(), realText));
 const [look, setLook] = useState<WorldIsoStageFrame>(() => stage.frame()); // which actors exist and how they face, for React-rendered parts
 const presentationRef = useRef(presentation); presentationRef.current = presentation;
 const realRef = useRef(realText); realRef.current = realText;
 const linesRef = useRef(lines.join("\n")), lookRef = useRef("");

 // Move elements directly; touch React state only when text or facing changes.
 const paint = useRef((frame: WorldIsoStageFrame) => {
  const z = new Map(frame.order.map((id, i) => [id, i + 1]));
  for (const prop of scene.props) { const el = elements.current.get(prop.id), value = String(z.get(prop.id) ?? 1); if (el && drawn.current.get(prop.id) !== value) { el.style.zIndex = value; drawn.current.set(prop.id, value); } }
  for (const a of frame.actors) {
   const el = elements.current.get(a.key);
   if (!el) continue;
   const value = a.present ? `${a.x.toFixed(1)},${a.y.toFixed(1)},${z.get(a.key) ?? 1},${a.facing},${a.moving ? 1 : 0},${a.frame}` : "hidden";
   if (drawn.current.get(a.key) === value) continue;
   drawn.current.set(a.key, value);
   el.style.display = a.present ? "" : "none";
   if (!a.present) continue;
   el.style.transform = `translate(${a.x.toFixed(1)}px, ${a.y.toFixed(1)}px)`;
   el.style.zIndex = String(z.get(a.key) ?? 1);
   el.dataset["facing"] = a.facing; el.dataset["moving"] = a.moving ? "true" : "false"; el.dataset["frame"] = String(a.frame);
   el.dataset["u"] = a.u.toFixed(3); el.dataset["v"] = a.v.toFixed(3);
  }
  const text = describe(frame, realRef.current), joined = text.join("\n");
  if (joined !== linesRef.current) { linesRef.current = joined; setLines(text); }
  const facingKey = frame.actors.map(a => `${a.key}:${a.facing}:${a.present ? 1 : 0}`).join("|");
  if (facingKey !== lookRef.current) { lookRef.current = facingKey; setLook(frame); }
 });

 useEffect(() => { stage.setReal(pals.filter(p => p.real !== null).map(p => p.id)); }, [stage, pals]);
 useEffect(() => {
  const step = (ms: number) => { const p = presentationRef.current; stage.advance(ms, { paused: p.paused || !p.visible, reduced: p.reducedMotion || p.lowPower }); paint.current(stage.frame()); };
  step(0); // place everyone; reduced motion and low power put characters straight on their spots
  controller?.({ advance: step, frame: () => stage.frame() });
  if (still(presentation) || typeof requestAnimationFrame !== "function") return () => controller?.(null);
  let raf = 0, last: number | null = null;
  const loop = (now: number) => { step(last === null ? 0 : Math.min(250, Math.max(0, now - last))); last = now; raf = requestAnimationFrame(loop); };
  raf = requestAnimationFrame(loop);
  return () => { cancelAnimationFrame(raf); controller?.(null); };
  // eslint-disable-next-line react-hooks/exhaustive-deps -- the loop restarts only when the stage or a pause flag changes
 }, [stage, controller, presentation.paused, presentation.reducedMotion, presentation.lowPower, presentation.visible]);

 const keep = (id: string) => (el: HTMLElement | SVGElement | null): void => { if (el) elements.current.set(id, el); else { elements.current.delete(id); drawn.current.delete(id); } };
 return <div data-iso-office="" role="group" aria-label="Isometric Office preview" style={{ position: "relative", overflow: "hidden", width: "100%", height: "100%", minHeight: 240, background: "#1c2030" }}>
  <div data-iso-world="" style={worldStyle(scene, cam)}>
   <StaticLayer scene={scene} />
   {scene.props.map(prop => <svg key={prop.id} ref={keep(prop.id)} data-iso-prop={prop.id} width={Math.ceil(prop.bounds.width) + 4} height={Math.ceil(prop.bounds.height) + 4}
    viewBox={`${prop.bounds.x - 2} ${prop.bounds.y - 2} ${Math.ceil(prop.bounds.width) + 4} ${Math.ceil(prop.bounds.height) + 4}`} style={{ position: "absolute", left: prop.bounds.x - 2, top: prop.bounds.y - 2, zIndex: 1 }} aria-hidden="true">
    <polygon points={points(prop.left)} fill="#6d7391" stroke="#1c2030" strokeWidth="1.5" />
    <polygon points={points(prop.right)} fill="#585e7a" stroke="#1c2030" strokeWidth="1.5" />
    <polygon points={points(prop.top)} fill="#8b91ad" stroke="#1c2030" strokeWidth="1.5" />
   </svg>)}
   {look.actors.map(a => <div key={a.key} ref={keep(a.key)} data-iso-actor={a.key} data-kind={a.kind} data-desk={a.desk ?? undefined} data-real={a.real ? "true" : "false"} style={{ position: "absolute", left: 0, top: 0, width: 0, height: 0, zIndex: 1, willChange: "transform" }}>
    {renderActor ? renderActor(a) : <Placeholder actor={a} />}
    <span style={{ position: "absolute", left: -70, top: 20, width: 140, textAlign: "center", font: "600 13px system-ui, sans-serif", color: "#fff", textShadow: "0 1px 2px #000", whiteSpace: "nowrap" }}>{a.name}</span>
   </div>)}
  </div>
  <span data-iso-badge="" style={{ position: "absolute", left: 8, top: 8, padding: "2px 8px", borderRadius: 6, background: "#f5c542", color: "#1c2030", font: "700 12px system-ui, sans-serif" }}>Preview: grey-box isometric Office (placeholder shapes, no artwork)</span>
  <ul aria-label="Who is in the room" style={{ position: "absolute", width: 1, height: 1, margin: -1, padding: 0, overflow: "hidden", clip: "rect(0 0 0 0)", whiteSpace: "nowrap", border: 0 }}>
   {lines.map((line, i) => <li key={i}>{line}</li>)}
  </ul>
 </div>;
}

/** Standalone isometric Office preview. Shows `fallback` if the plan is invalid or drawing fails. */
export function WorldIsoOffice({ pals, visitors, presentation, fallback, camera, plan, seed, renderActor, controller, onFallback }: WorldIsoOfficeProps) {
 // Rebuild the stage only when who is in the room, the plan or the seed changes; never per frame.
 const castKey = `${pals.map(p => `${p.id}@${p.desk}${p.sits ? "s" : ""}`).join(",")}|${visitors.map(v => v.id).join(",")}|${seed ?? ""}`;
 const stage = useMemo(() => {
  try { return createWorldIsoStage({ ...(plan !== undefined ? { plan } : {}), pals: pals.map(p => ({ id: p.id, name: p.name, desk: p.desk, real: p.real !== null, sits: p.sits === true })), visitors, ...(seed !== undefined ? { seed } : {}) }); }
  catch { return { ok: false as const, problems: [] }; }
  // eslint-disable-next-line react-hooks/exhaustive-deps -- castKey stands for pals, visitors and seed
 }, [plan, castKey]);
 const failed = !stage.ok;
 useEffect(() => { if (failed) onFallback?.("invalid-plan"); }, [failed, onFallback]);
 if (!stage.ok) return <Fallback reason="invalid-plan">{fallback}</Fallback>;
 return <Boundary fallback={fallback} {...(onFallback ? { onFallback } : {})}>
  <Room key={castKey} stage={stage} pals={pals} presentation={presentation} camera={camera} renderActor={renderActor} controller={controller} />
 </Boundary>;
}

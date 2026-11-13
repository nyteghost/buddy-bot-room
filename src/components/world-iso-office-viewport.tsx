import { useCallback, useEffect, useRef, useState, type PointerEvent, type WheelEvent } from "react";
import { WorldHdOffice, type HdOfficePal } from "./world-hd-office";
import { WorldIsoOffice, type WorldIsoActorPoint } from "./world-iso-office";
import type { WorldCustomCharacter } from "@/lib/world-custom-packs";
import type { WorldCamera, WorldSize, ScreenPoint } from "@/lib/world-camera";
import { worldIsoCameraFit, worldIsoCameraClamp, worldIsoCameraPan, worldIsoCameraZoomAt,
 worldIsoCameraPinch, worldIsoCameraFollow } from "@/lib/world-iso-camera";

type Props = Readonly<{
 pals: readonly HdOfficePal[]; visitors: readonly WorldCustomCharacter[];
 visible: boolean; playful: boolean; paused: boolean; synthetic: boolean;
}>;
type NamedActor = Readonly<{ id: string; name: string }>;
const initialSize: WorldSize = { width: 900, height: 520 };

/** Stage 4A visual-only host: one camera/input owner, one active renderer.
 * Flat HD is a real fallback with its original controls, not a text error. */
export function WorldIsoOfficeViewport(props: Props) {
 const area = useRef<HTMLDivElement | null>(null);
 const [viewport, setViewport] = useState<WorldSize>(initialSize);
 const viewportRef = useRef(viewport); viewportRef.current = viewport;
 const [camera, setCamera] = useState<WorldCamera>(() => worldIsoCameraFit(initialSize));
 const [failed, setFailed] = useState(false);
 const [follow, setFollow] = useState("");
 const followRef = useRef(follow); followRef.current = follow;
 const positions = useRef<Map<string, ScreenPoint>>(new Map());
 const pointers = useRef(new Map<number, ScreenPoint>());
 const dragged = useRef(false);
 const observeActors = useCallback((actors: readonly WorldIsoActorPoint[]) => {
  positions.current = new Map(actors.map(actor => [actor.id, { x: actor.x, y: actor.y }]));
  const target = positions.current.get(followRef.current);
  if (target) setCamera(previous => worldIsoCameraFollow(previous, target, viewportRef.current));
 }, []);
 useEffect(() => {
  const el = area.current; if (!el) return;
  let first = true;
  const measure = () => {
   const rect = el.getBoundingClientRect();
   if (rect.width < 80 || rect.height < 80) return;
   const size = { width: Math.round(rect.width), height: Math.round(rect.height) };
   const initial = first; first = false;
   viewportRef.current = size;
   setViewport(old => old.width === size.width && old.height === size.height ? old : size);
   setCamera(old => initial ? worldIsoCameraFit(size) : worldIsoCameraClamp(old, size));
  };
  measure();
  const observer = typeof ResizeObserver === "undefined" ? null : new ResizeObserver(measure);
  observer?.observe(el);
  window.addEventListener("resize", measure);
  return () => { observer?.disconnect(); window.removeEventListener("resize", measure); };
 }, []);
 const names: NamedActor[] = [
  ...props.pals.filter(p => p.enabled).map(p => ({ id: "pal:" + p.id, name: p.name })),
  ...[...new Map(props.visitors.map(v => [v.id, v])).values()].sort((a, b) => a.id.localeCompare(b.id))
   .slice(0, 6).map(v => ({ id: "custom:" + v.id, name: v.name })),
 ];
 const selectFollow = (id: string) => {
  setFollow(id); followRef.current = id;
  const point = positions.current.get(id);
  if (point) setCamera(prev => worldIsoCameraFollow(prev, point, viewportRef.current));
 };
 const stopFollow = () => { setFollow(""); followRef.current = ""; };
 const local = (e: { clientX: number; clientY: number }): ScreenPoint => {
  const rect = area.current?.getBoundingClientRect();
  return { x: e.clientX - (rect?.left ?? 0), y: e.clientY - (rect?.top ?? 0) };
 };
 const onDown = (e: PointerEvent<HTMLDivElement>) => {
  if (e.pointerType !== "touch" && e.button !== 0) return;
  dragged.current = false;
  pointers.current.set(e.pointerId, local(e));
  e.currentTarget.setPointerCapture?.(e.pointerId);
 };
 const onMove = (e: PointerEvent<HTMLDivElement>) => {
  if (!pointers.current.has(e.pointerId)) return;
  const before = [...pointers.current.values()];
  const at = local(e), previous = pointers.current.get(e.pointerId)!;
  pointers.current.set(e.pointerId, at);
  const after = [...pointers.current.values()];
  if (Math.hypot(at.x - previous.x, at.y - previous.y) < 0.4) return;
  dragged.current = true; stopFollow();
  if (before.length === 2 && after.length === 2) {
   setCamera(old => worldIsoCameraPinch(old, before as [ScreenPoint, ScreenPoint], after as [ScreenPoint, ScreenPoint], viewportRef.current));
  } else if (after.length === 1) {
   setCamera(old => worldIsoCameraPan(old, at.x - previous.x, at.y - previous.y, viewportRef.current));
  }
 };
 const onUp = (e: PointerEvent<HTMLDivElement>) => {
  const wasMoving = dragged.current;
  pointers.current.delete(e.pointerId);
  if (e.currentTarget.hasPointerCapture?.(e.pointerId)) e.currentTarget.releasePointerCapture(e.pointerId);
  if (!wasMoving) {
   const target = (e.target as Element).closest?.("[data-iso-actor]")?.getAttribute("data-iso-actor");
   if (target) selectFollow(target);
  }
 };
 const onWheel = (e: WheelEvent<HTMLDivElement>) => {
  e.preventDefault(); stopFollow();
  setCamera(old => worldIsoCameraZoomAt(old, Math.exp(-e.deltaY * (e.ctrlKey ? 0.01 : 0.0015)), local(e), viewportRef.current));
 };
 const zoom = (factor: number) => {
  setCamera(old => worldIsoCameraZoomAt(old, factor, { x: viewportRef.current.width / 2, y: viewportRef.current.height / 2 }, viewportRef.current));
 };
 const fit = () => { stopFollow(); setCamera(worldIsoCameraFit(viewportRef.current)); };
 const onKey = (e: React.KeyboardEvent<HTMLDivElement>) => {
  const vector: Record<string, [number, number]> = {
   ArrowLeft: [35, 0], ArrowRight: [-35, 0], ArrowUp: [0, 35], ArrowDown: [0, -35],
  };
  if (vector[e.key]) { e.preventDefault(); stopFollow(); const [x, y] = vector[e.key]!; setCamera(old => worldIsoCameraPan(old, x, y, viewportRef.current)); }
  else if (e.key === "+" || e.key === "=") { e.preventDefault(); zoom(1.25); }
  else if (e.key === "-") { e.preventDefault(); zoom(0.8); }
  else if (e.key.toLowerCase() === "f" && !e.ctrlKey && !e.metaKey) { e.preventDefault(); fit(); }
 };
 if (failed) return <WorldHdOffice {...props} />;
 return <div className="hd-office iso-office" data-iso-mounted="true">
  <div ref={area} className="hd-office-viewport iso-office-stage" tabIndex={0} aria-label="Isometric Office camera, use arrow keys to pan and plus or minus to zoom"
   onPointerDown={onDown} onPointerMove={onMove} onPointerUp={onUp} onPointerCancel={onUp} onWheel={onWheel}
   onKeyDown={onKey} onDoubleClick={e => { stopFollow(); setCamera(old => worldIsoCameraZoomAt(old, 1.5, local(e), viewportRef.current)); }}>
   <WorldIsoOffice {...props} camera={camera} viewport={viewport} fallback={<WorldHdOffice {...props} />}
    onFailure={() => setFailed(true)} onActorPositions={observeActors} />
  </div>
  <div className="hd-office-toolbar iso-office-toolbar" role="toolbar" aria-label="Room camera">
   <button type="button" onClick={fit}>Fit room</button>
   <button type="button" aria-label="Zoom out" onClick={() => zoom(0.8)}>−</button>
   <span className="hd-zoom" aria-live="off">{Math.round(camera.zoom * 100)}%</span>
   <button type="button" aria-label="Zoom in" onClick={() => zoom(1.25)}>+</button>
   <label>Follow <select aria-label="Follow a character" value={names.some(a => a.id === follow) ? follow : ""} onChange={e => selectFollow(e.target.value)}>
    <option value="">Nobody</option>
    {names.map(a => <option key={a.id} value={a.id}>{a.name}</option>)}
   </select></label>
  </div>
 </div>;
}

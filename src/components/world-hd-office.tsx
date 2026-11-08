import { useCallback, useEffect, useMemo, useRef, useState, type CSSProperties, type KeyboardEvent, type ReactNode } from "react";
import type { AgentId } from "@/lib/agents";
import type { Heading } from "@/lib/office-motion";
import type { PalMotion } from "@/lib/pal-motion";
import type { WorldCustomCharacter } from "@/lib/world-custom-packs";
import { WorldCrowd, worldCrowdTieBreak, WORLD_CROWD_PRIORITY } from "@/lib/world-crowd";
import { screenToWorld, worldCameraClamp, worldCameraFit, worldCameraFollow, worldCameraPan, worldCameraPinch, worldCameraTransform, worldCameraVisible, worldCameraZoomAt, worldToScreen, type WorldCamera, type WorldSize } from "@/lib/world-camera";
import { AMBIENT_PERIOD, ambientDescription, ambientPose, ambientSchedule, type AmbientActor, type AmbientPose } from "@/lib/world-ambient";
import { HD_OFFICE_ACTOR_PX, HD_OFFICE_CHAT_PAIRS, HD_OFFICE_FOOTPRINT, HD_OFFICE_MAX_ZOOM, HD_OFFICE_PROPS, HD_OFFICE_SPOTS, HD_OFFICE_WALL, HD_OFFICE_WORLD, hdOfficeFloor, type HdOfficeProp } from "@/lib/world-hd-office";
import { selectWorldHdClip, worldHdAction, worldHdFrameAt } from "@/lib/world-hd-animation";
import { worldHdFrameMetrics } from "@/lib/world-hd-render";
import { WORLD_HEIGHT_CLASSES } from "@/lib/world-scale";
import { drawSyntheticCharacter, syntheticPalette } from "@/lib/world-synthetic-art";
import { useWorldPalSkins, useWorldPalPixelSkins, useWorldSkinCharacters, worldPalLookCharacter } from "@/lib/world-pal-skins";
import { useReducedMotion } from "@/lib/reduced-motion";
import { lowPower, useTabHidden } from "@/lib/power";
import { spriteRuns } from "@/lib/sprite-upscale";
import { worldReactionFrame } from "@/lib/world-animation";
import { PixelCharacter } from "./pixel-character";

/** Real (authoritative) activity from the app's agent state — the only source of "working" in this room. */
export type HdOfficeRealActivity = "responding" | "focus" | null;
export type HdOfficePal = Readonly<{ id: AgentId; name: string; enabled: boolean; real: HdOfficeRealActivity }>;
const REAL_TEXT: Record<Exclude<HdOfficeRealActivity, null>, string> = { responding: "Responding to you", focus: "Focus session with you" };

const W = HD_OFFICE_WORLD.width, H = HD_OFFICE_WORLD.height, WORLD: WorldSize = HD_OFFICE_WORLD;
const ACTOR = HD_OFFICE_ACTOR_PX, FIGURE = ACTOR * 0.92, NATIVE_PX = FIGURE / 35;
const MAX_ZOOM = HD_OFFICE_MAX_ZOOM;
const VISITOR_HOMES = ["sofa-1", "sofa-3", "window-1", "coffee-1", "board-1", "shelf-1"];

type ActorArt = { kind: "hd"; character: WorldCustomCharacter } | { kind: "synthetic" } | { kind: "native"; pal: AgentId } | { kind: "pixels"; character: WorldCustomCharacter };
type ActorInfo = { id: string; name: string; kind: "pal" | "visitor"; pal?: AgentId; art: ActorArt; desk?: string; heightScale: number };
type Visual = { facing: Heading; motion: PalMotion; walking: boolean; frame: number };

// ---------- static environment (synthetic layered art, sharp at every zoom) ----------
function propSvg(p: HdOfficeProp): string {
 const x = p.foot.x1 / 100 * W, w = (p.foot.x2 - p.foot.x1) / 100 * W, top = p.top / 100 * H, bottom = p.foot.y2 / 100 * H, h = bottom - top;
 const line = `stroke="#120c16" stroke-width="5" stroke-linejoin="round"`;
 let body = "";
 switch (p.draw) {
  case "desk": body = `<rect x="6" y="${h * .45}" width="${w - 12}" height="${h * .16}" rx="8" fill="#7a5236" ${line}/>
   <rect x="18" y="${h * .58}" width="20" height="${h * .4}" fill="#5b3a24" ${line}/><rect x="${w - 38}" y="${h * .58}" width="20" height="${h * .4}" fill="#5b3a24" ${line}/>
   <rect x="${w * .3}" y="${h * .06}" width="${w * .4}" height="${h * .36}" rx="8" fill="#1d2433" ${line}/>
   <rect class="hd-screen" x="${w * .33}" y="${h * .1}" width="${w * .34}" height="${h * .27}" rx="4"/>
   <rect x="${w * .46}" y="${h * .4}" width="${w * .08}" height="${h * .06}" fill="#1d2433"/>`; break;
  case "sofa": body = `<rect x="6" y="${h * .05}" width="${w - 12}" height="${h * .5}" rx="40" fill="#5c3d7a" ${line}/>
   <rect x="6" y="${h * .45}" width="${w - 12}" height="${h * .35}" rx="26" fill="#7a55a0" ${line}/><rect x="0" y="${h * .3}" width="70" height="${h * .55}" rx="30" fill="#5c3d7a" ${line}/>
   <rect x="${w - 70}" y="${h * .3}" width="70" height="${h * .55}" rx="30" fill="#5c3d7a" ${line}/>`; break;
  case "table": body = `<ellipse cx="${w / 2}" cy="${h * .3}" rx="${w / 2 - 6}" ry="${h * .26}" fill="#8b5e3c" ${line}/><rect x="${w / 2 - 14}" y="${h * .42}" width="28" height="${h * .58}" fill="#5b3a24" ${line}/>
   <circle cx="${w * .35}" cy="${h * .25}" r="14" fill="#f4e7d0"/><circle cx="${w * .62}" cy="${h * .28}" r="11" fill="#e45b5b"/>`; break;
  case "counter": body = `<rect x="4" y="${h * .52}" width="${w - 8}" height="${h * .46}" rx="8" fill="#d9d4cc" ${line}/><rect x="4" y="${h * .48}" width="${w - 8}" height="${h * .08}" fill="#8f8a84" ${line}/>
   <rect x="${w * .1}" y="${h * .1}" width="${w * .18}" height="${h * .38}" rx="10" fill="#2a2f3a" ${line}/><circle cx="${w * .19}" cy="${h * .25}" r="12" fill="#ff8f3d"/>
   <rect x="${w * .62}" y="${h * .22}" width="${w * .3}" height="${h * .26}" rx="6" fill="#e6e1d8" ${line}/>`; break;
  case "shelf": body = `<rect x="4" y="4" width="${w - 8}" height="${h - 8}" rx="6" fill="#5b3a24" ${line}/>
   ${[0.22, 0.44, 0.66, 0.88].map(f => `<rect x="12" y="${h * f}" width="${w - 24}" height="9" fill="#3a2516"/>` + Array.from({ length: 6 }, (_, k) => `<rect x="${18 + k * (w - 36) / 6}" y="${h * f - 52 + (k % 3) * 6}" width="${(w - 48) / 7}" height="${52 - (k % 3) * 6}" fill="${["#c0392b", "#2e86de", "#f6b93b", "#38ada9", "#8e44ad"][k % 5]}"/>`).join("")).join("")}`; break;
  case "plant": body = `<path d="M${w / 2} ${h * .62} C ${w * .1} ${h * .3}, ${w * .1} ${h * .05}, ${w * .45} ${h * .02} C ${w * .9} ${h * .05}, ${w * .95} ${h * .35}, ${w / 2} ${h * .62}Z" fill="#2f8f4e" ${line}/>
   <rect x="${w * .25}" y="${h * .6}" width="${w * .5}" height="${h * .38}" rx="12" fill="#b5653a" ${line}/>`; break;
  case "printer": body = `<rect x="4" y="${h * .3}" width="${w - 8}" height="${h * .66}" rx="8" fill="#cfd4dc" ${line}/><rect x="${w * .15}" y="${h * .2}" width="${w * .7}" height="${h * .16}" fill="#f6f6f6" ${line}/>`; break;
  default: body = "";
 }
 return `<svg class="hd-prop" data-prop="${p.id}" style="left:${x}px;top:${top}px;width:${w}px;height:${h}px;z-index:${Math.round(p.foot.y2 * 10)}" viewBox="0 0 ${w} ${h}" xmlns="http://www.w3.org/2000/svg" aria-hidden="true">${body}</svg>`;
}
function backgroundSvg(): string {
 const wallH = H * 0.28, planks: string[] = [];
 for (let y = wallH; y < H; y += 46) planks.push(`<line x1="0" y1="${y}" x2="${W}" y2="${y}" stroke="#3e2b20" stroke-opacity=".28" stroke-width="2"/>`);
 for (let i = 0; i < 70; i++) { const y = wallH + (i * 46) % (H - wallH), x = (i * 397) % W; planks.push(`<line x1="${x}" y1="${y}" x2="${x}" y2="${y + 46}" stroke="#2f2018" stroke-opacity=".3" stroke-width="2"/>`); }
 const wall = HD_OFFICE_WALL.map(a => {
  const x = a.x1 / 100 * W, y = a.y1 / 100 * H, w = (a.x2 - a.x1) / 100 * W, h = (a.y2 - a.y1) / 100 * H;
  if (a.draw === "window") return `<rect x="${x}" y="${y}" width="${w}" height="${h}" rx="8" fill="url(#hd-night)" stroke="#2e2a3a" stroke-width="14"/>${Array.from({ length: 5 }, (_, k) => `<rect x="${x + 14 + k * (w - 28) / 5}" y="${y + h * (0.45 - (k * 37 % 30) / 100)}" width="${(w - 28) / 5 - 8}" height="${h * (0.55 + (k * 37 % 30) / 100) - 10}" fill="#151a33"/>`).join("")}<line x1="${x + w / 2}" y1="${y}" x2="${x + w / 2}" y2="${y + h}" stroke="#2e2a3a" stroke-width="8"/>`;
  if (a.draw === "board") return `<rect x="${x}" y="${y}" width="${w}" height="${h}" rx="6" fill="#f3f4f6" stroke="#4b5563" stroke-width="10"/><path d="M${x + 40} ${y + h * .65} L ${x + w * .3} ${y + h * .35} L ${x + w * .5} ${y + h * .55} L ${x + w * .8} ${y + h * .25}" stroke="#2563eb" stroke-width="7" fill="none"/>${[0.15, 0.3, 0.45].map(f => `<rect x="${x + w * .62}" y="${y + h * (f + .3)}" width="${w * .28}" height="10" rx="4" fill="#9ca3af"/>`).join("")}`;
  return `<rect x="${x}" y="${y}" width="${w}" height="${h}" rx="6" fill="#4a3424" stroke="#1d140e" stroke-width="10"/><circle cx="${x + w * .8}" cy="${y + h * .55}" r="9" fill="#e5c07b"/>`;
 }).join("");
 return `<svg class="hd-env" width="${W}" height="${H}" viewBox="0 0 ${W} ${H}" xmlns="http://www.w3.org/2000/svg" aria-hidden="true">
 <defs><linearGradient id="hd-wall" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#26303f"/><stop offset="1" stop-color="#344156"/></linearGradient>
 <linearGradient id="hd-floor" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#6a4a35"/><stop offset="1" stop-color="#7d583d"/></linearGradient>
 <linearGradient id="hd-night" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#0b1030"/><stop offset="1" stop-color="#3a2a6b"/></linearGradient>
 <radialGradient id="hd-rug"><stop offset="0" stop-color="#3b5b7a"/><stop offset="1" stop-color="#253a52"/></radialGradient>
 <radialGradient id="hd-lamp"><stop offset="0" stop-color="#ffe7a6" stop-opacity=".18"/><stop offset="1" stop-color="#ffe7a6" stop-opacity="0"/></radialGradient></defs>
 <rect width="${W}" height="${wallH}" fill="url(#hd-wall)"/>${wall}
 <rect y="${wallH - 30}" width="${W}" height="30" fill="#1b2230"/>
 <rect y="${wallH}" width="${W}" height="${H - wallH}" fill="url(#hd-floor)"/>${planks.join("")}
 <ellipse cx="${W * .77}" cy="${H * .62}" rx="${W * .15}" ry="${H * .13}" fill="url(#hd-rug)" opacity=".9"/>
 ${[0.2, 0.45, 0.75].map(f => `<circle cx="${W * f}" cy="${H * .5}" r="560" fill="url(#hd-lamp)"/>`).join("")}
 </svg>`;
}
const ENVIRONMENT = (() => { let html = ""; return () => (html ||= backgroundSvg() + HD_OFFICE_PROPS.map(propSvg).join("")); })();

// ---------- one character's visual ----------
function hdFootOffset(character: WorldCustomCharacter) {
 return character.hd3?.directions.s?.idle?.frames[0]?.src ?? character.hd?.idle[0];
}
function ActorVisual({ info, visual, synthetic, measured }: { info: ActorInfo; visual: Visual; synthetic: boolean; measured: { top: number; foot: number } | null }): ReactNode {
 const canvas = useRef<HTMLCanvasElement | null>(null);
 const art = info.art.kind === "synthetic" && !synthetic && info.pal ? { kind: "native" as const, pal: info.pal } : info.art;
 useEffect(() => {
  if (art.kind !== "synthetic" || !canvas.current) return;
  const ctx = canvas.current.getContext("2d");
  if (ctx) drawSyntheticCharacter(ctx, syntheticPalette(info.pal ?? info.id), { facing: visual.facing, phase: visual.frame / 12, walking: visual.walking, breath: Math.sin(visual.frame), motion: visual.motion });
 }, [art.kind, info.pal, info.id, visual.facing, visual.frame, visual.walking, visual.motion]);
 if (art.kind === "hd") {
  const hd3 = art.character.hd3;
  const kind = worldHdAction(visual.walking ? "walk" : visual.motion);
  const selected = hd3 ? selectWorldHdClip(hd3, visual.facing, kind) : undefined;
  const src = selected ? worldHdFrameAt(selected.clip, visual.frame * 120) : (visual.walking ? art.character.hd?.walk : art.character.hd?.idle)?.[visual.frame % Math.max(1, (visual.walking ? art.character.hd?.walk : art.character.hd?.idle)?.length ?? 1)];
  // Size from the measured figure (top of head → lowest foot pixel), feet on the anchor; painted art stays smooth.
  const figure = measured ? Math.max(16, measured.foot - measured.top + 1) : 240, foot = measured ? measured.foot : 247;
  const size = FIGURE * info.heightScale * 256 / figure;
  return src ? <img className="hd-actor-art" src={src} alt="" draggable={false} width={256} height={256}
   style={{ width: size, height: size, marginBottom: -(255 - foot) * size / 256 }} /> : null;
 }
 if (art.kind === "synthetic") return <canvas ref={canvas} className="hd-actor-art hd-actor-synthetic" width={256} height={256} style={{ width: ACTOR, height: ACTOR }} />;
 if (art.kind === "pixels") {
  const grid = worldReactionFrame(art.character.pixels, visual.facing, null, visual.walking ? "walk" : visual.motion, visual.frame % 4);
  const runs = spriteRuns(grid, () => "body");
  return <svg className="hd-actor-native" viewBox={`0 0 32 ${grid.length}`} preserveAspectRatio="xMidYMax meet" shapeRendering="crispEdges" style={{ width: 32 * NATIVE_PX, height: 32 * NATIVE_PX }}>
   {runs.map(r => <rect key={r.x + "-" + r.y} x={r.x} y={r.y} width={r.w} height="1" fill={art.character.palette[r.c] ?? "transparent"} />)}</svg>;
 }
 return <div className="hd-actor-native" style={{ width: 32 * NATIVE_PX, height: 38 * NATIVE_PX }}>
  <PixelCharacter id={art.pal} mode="linux" walking={visual.walking} motion={visual.walking ? undefined : visual.motion} pixelWorld walkFrame={visual.frame % 4} facing={visual.facing} />
 </div>;
}

/**
 * Living Universe HD — Office (feature-flagged preview). A larger layered office seen through a camera,
 * with calm ambient life and honest activity: only the app's real agent state can show a Pal working.
 */
export function WorldHdOffice({ pals: palsProp, visitors: visitorsProp, visible, playful, paused, synthetic }: {
 pals: readonly HdOfficePal[]; visitors: readonly WorldCustomCharacter[]; visible: boolean; playful: boolean; paused: boolean; synthetic: boolean;
}) {
 // The room re-renders often; keep inputs stable so the schedule and loop only change when the room really does.
 const palsKey = JSON.stringify(palsProp);
 const pals = useMemo(() => palsProp, [palsKey]); // eslint-disable-line react-hooks/exhaustive-deps
 const visitorsKey = visitorsProp.map(c => `${c.id}:${c.hd3?.version ?? 0}:${c.hd3?.height ?? ""}:${c.name}`).join("|");
 const visitors = useMemo(() => visitorsProp, [visitorsKey]); // eslint-disable-line react-hooks/exhaustive-deps
 const floor = hdOfficeFloor();
 const reduced = useReducedMotion(), low = lowPower.use(), hidden = useTabHidden();
 const running = visible && playful && !paused && !reduced && !low && !hidden;
 const hdSkins = useWorldPalSkins(), pixelSkins = useWorldPalPixelSkins();
 // Looks resolve against every installed character (published by the Character Library), not only visitors in the room.
 const installed = useWorldSkinCharacters();
 const lookList = installed.length ? installed : visitors;
 // Who is in the room (enabled Pals + up to six visitors) and which art each one uses.
 const actors = useMemo<ActorInfo[]>(() => [
  ...pals.filter(p => p.enabled).map((p): ActorInfo => {
   const look = worldPalLookCharacter("hd", hdSkins, pixelSkins, lookList, p.id);
   const index = ["nova", "byte", "sage", "pip", "echo", "rune", "claude", "saiyan", "mimic"].indexOf(p.id);
   return { id: "pal:" + p.id, name: p.name, kind: "pal", pal: p.id, desk: "seat-" + Math.max(0, index), heightScale: 1,
    art: look ? { kind: "hd", character: look } : { kind: "synthetic" } };
  }),
  ...visitors.slice(0, 6).map((c): ActorInfo => ({ id: "custom:" + c.id, name: c.name, kind: "visitor", heightScale: WORLD_HEIGHT_CLASSES[c.hd3?.height ?? "adult"],
   art: c.hd3 || c.hd ? { kind: "hd", character: c } : { kind: "pixels", character: c } })),
 ], [pals, visitors, hdSkins, pixelSkins, lookList]);
 const actorKey = actors.map(a => a.id).join(",");
 const night = useMemo(() => { const h = new Date().getHours(); return h >= 22 || h < 6; }, []);
 const plans = useMemo(() => ambientSchedule({
  theme: floor, spots: HD_OFFICE_SPOTS, chatPairs: HD_OFFICE_CHAT_PAIRS, seed: "hd-office", night,
  actors: actors.map((a, i): AmbientActor => ({ id: a.id, name: a.name, kind: a.kind, home: a.desk ?? VISITOR_HOMES[i % VISITOR_HOMES.length]!, speed: 5 })),
 }), [actorKey, night, floor]); // eslint-disable-line react-hooks/exhaustive-deps
 const real = useRef(new Map<string, HdOfficeRealActivity>());
 real.current = new Map(pals.map(p => ["pal:" + p.id, p.real]));
 const crowd = useMemo(() => new WorldCrowd(floor), [floor]);
 const start = useMemo(() => Date.now() % AMBIENT_PERIOD, []);
 const seat = (a: ActorInfo) => HD_OFFICE_SPOTS.find(s => s.id === a.desk);
 // Route for the crowd: ambient schedule, or straight to the Pal's own desk while it really works.
 const routeOf = useCallback((a: ActorInfo) => (t: number) => {
  const r = real.current.get(a.id), desk = seat(a);
  if (r && desk) return { x: desk.point.x, y: desk.point.y, walking: false, facing: "n" as Heading };
  const p = ambientPose(plans.get(a.id)!, t);
  return { x: p.x, y: p.y, walking: p.walking, facing: p.facing };
 }, [plans]);
 useEffect(() => {
  const now = performance.now();
  for (const a of actors) crowd.join({ id: a.id, priority: (a.kind === "pal" ? WORLD_CROWD_PRIORITY.pal : WORLD_CROWD_PRIORITY.visitor) + worldCrowdTieBreak(a.id),
   rx: HD_OFFICE_FOOTPRINT.rx * Math.sqrt(a.heightScale), ry: HD_OFFICE_FOOTPRINT.ry * Math.sqrt(a.heightScale), speed: 5, plan: routeOf(a) }, start, now);
  for (const id of crowd.ids()) if (!actors.some(a => a.id === id)) crowd.leave(id);
 }, [crowd, actors, routeOf, start]);

 // ---------- camera, DOM refs ----------
 const viewport = useRef<HTMLDivElement | null>(null), worldLayer = useRef<HTMLDivElement | null>(null);
 const actorEls = useRef(new Map<string, HTMLDivElement>()), tagEls = useRef(new Map<string, HTMLDivElement>());
 const size = useRef<WorldSize>({ width: 900, height: 523 });
 const camera = useRef<WorldCamera>({ x: W * 0.5, y: H * 0.6, zoom: 0.5 });
 const [zoom, setZoom] = useState(0.5);
 const [follow, setFollow] = useState<string | null>(null);
 const followRef = useRef<string | null>(null); followRef.current = follow;
 const waves = useRef(new Map<string, number>());
 const [visuals, setVisuals] = useState<Record<string, Visual>>({});
 const visualsRef = useRef(visuals); visualsRef.current = visuals;
 const [describe, setDescribe] = useState<Record<string, string>>({});
 const [measured, setMeasured] = useState<Record<string, { top: number; foot: number }>>({});
 useEffect(() => {
  let live = true;
  for (const a of actors) if (a.art.kind === "hd") {
   const src = hdFootOffset(a.art.character);
   if (src) void worldHdFrameMetrics(src).then(m => { if (live && m) setMeasured(prev => prev[a.id] ? prev : { ...prev, [a.id]: { top: m.top, foot: m.foot } }); });
  }
  return () => { live = false; };
 }, [actors]);
 const setCamera = useCallback((next: WorldCamera) => { camera.current = worldCameraClamp(next, WORLD, size.current, MAX_ZOOM); setZoom(camera.current.zoom); }, []);

 // Draw one frame: positions, depth, labels, desk screens. Visual state changes go through React (rare).
 const pose = useCallback((a: ActorInfo): { x: number; y: number; ambient: AmbientPose | null; walking: boolean; facing: Heading; lag: number; walked: number } => {
  const cp = crowd.pose(a.id);
  const plan = plans.get(a.id);
  const ambient = plan && cp ? ambientPose(plan, cp.time) : null;
  const facing = cp?.walking || cp?.waiting ? cp.facing : real.current.get(a.id) ? "n" : ambient?.facing ?? "s";
  return { x: cp?.x ?? ambient?.x ?? 50, y: cp?.y ?? ambient?.y ?? 70, ambient, walking: !!cp?.walking, facing, lag: cp?.lag ?? 0, walked: cp?.walked ?? 0 };
 }, [crowd, plans]);
 const paint = useCallback((dt: number) => {
  const vp = size.current;
  if (followRef.current) {
   const p = pose(actors.find(a => a.id === followRef.current) ?? actors[0]!);
   camera.current = worldCameraFollow(camera.current, { x: p.x / 100 * W, y: p.y / 100 * H - FIGURE / 2 }, dt, WORLD, vp, { reduced, max: MAX_ZOOM });
  }
  if (worldLayer.current) worldLayer.current.style.transform = worldCameraTransform(camera.current, vp);
  const vis = worldCameraVisible(camera.current, vp, ACTOR);
  const nextVisuals: Record<string, Visual> = {};
  let changed = false;
  const now = performance.now();
  for (const a of actors) {
   const p = pose(a), wx = p.x / 100 * W, wy = p.y / 100 * H;
   const el = actorEls.current.get(a.id), tag = tagEls.current.get(a.id);
   const on = wx > vis.x1 && wx < vis.x2 && wy > vis.y1 && wy < vis.y2 + ACTOR;
   if (el) { el.style.left = wx + "px"; el.style.top = wy + "px"; el.style.zIndex = String(Math.round(p.y * 10) + 1); el.style.visibility = on ? "visible" : "hidden"; }
   const r = real.current.get(a.id);
   const atDesk = !!r && p.lag < 1 && !p.walking;
   const waving = (waves.current.get(a.id) ?? 0) > now;
   const motion: PalMotion = p.walking ? "walk" : waving ? "wave" : atDesk ? "work" : p.lag >= 1 ? "look" : p.ambient?.motion ?? "idle";
   const frame = p.walking ? Math.floor(p.walked / 1.2) % 12 : Math.floor(now / 600) % 12;
   const v: Visual = { facing: p.facing, motion, walking: p.walking, frame };
   const old = visualsRef.current[a.id];
   if (!old || old.facing !== v.facing || old.motion !== v.motion || old.walking !== v.walking || old.frame !== v.frame) changed = true;
   nextVisuals[a.id] = v;
   if (tag) {
    const s = worldToScreen(camera.current, vp, { x: wx, y: wy });
    const show = on && (camera.current.zoom >= 0.34 || followRef.current === a.id || !!r);
    tag.style.display = show ? "flex" : "none";
    tag.style.transform = `translate(${Math.round(s.x)}px, ${Math.round(s.y + 4)}px) translateX(-50%)`;
   }
  }
  // Desk screens light up only for genuine work at that desk.
  const host = worldLayer.current;
  if (host) for (const a of actors) if (a.desk) {
   const index = a.desk.replace("seat-", "");
   const screen = host.querySelector(`[data-prop="desk-${index}"] .hd-screen`);
   const p = pose(a);
   screen?.classList.toggle("hd-screen-busy", !!real.current.get(a.id) && p.lag < 1 && !p.walking);
  }
  if (changed) setVisuals(nextVisuals);
 }, [actors, pose, reduced]);

 // Simulation loop (rAF; pauses with hidden tabs, low power, reduced motion, Focus Mode and calm mood).
 useEffect(() => {
  let raf = 0, last = performance.now(), describedAt = 0;
  const describeNow = () => {
   const out: Record<string, string> = {};
   for (const a of actors) {
    const r = real.current.get(a.id), p = pose(a);
    out[a.id] = r ? `${REAL_TEXT[r]} (real activity)` : p.walking ? "walking (ambient animation)" : `${ambientDescription(p.ambient?.activity ?? "desk", p.ambient?.partnerName)} (ambient animation, not a task)`;
   }
   setDescribe(prev => JSON.stringify(prev) === JSON.stringify(out) ? prev : out);
  };
  const loop = (now: number) => {
   const dt = Math.min(100, now - last); last = now;
   if (running) for (const a of actors) crowd.advance(a.id, dt, now);
   paint(dt);
   if (now - describedAt > 1000) { describedAt = now; describeNow(); }
   raf = requestAnimationFrame(loop);
  };
  // When motion is not allowed, draw once (static positions) and when real state changes.
  if (!running) { paint(16); describeNow(); return; }
  raf = requestAnimationFrame(loop);
  return () => cancelAnimationFrame(raf);
 }, [running, actors, crowd, paint, pose, pals]);

 // Viewport size and initial framing.
 useEffect(() => {
  const el = viewport.current;
  if (!el) return;
  const update = () => {
   const first = size.current.width === 900 && size.current.height === 523 && !el.dataset["sized"];
   size.current = { width: el.clientWidth || 900, height: el.clientHeight || 523 };
   el.dataset["sized"] = "1";
   // Phones forced to HD open wider (the room is large); desktops open at a comfortable reading size.
   if (first) setCamera({ x: W * 0.5, y: H * 0.6, zoom: size.current.width < 600 ? 0.3 : 0.5 }); else setCamera(camera.current);
   paint(16);
  };
  update();
  const ro = typeof ResizeObserver === "undefined" ? null : new ResizeObserver(update);
  ro?.observe(el);
  return () => ro?.disconnect();
 }, [setCamera, paint]);

 // Input: drag / one finger pans, wheel / pinch zooms at the pointer, keyboard, click a character to follow.
 const pointers = useRef(new Map<number, { x: number; y: number }>()), dragged = useRef(0), downOn = useRef<string | null>(null);
 const local = (e: { clientX: number; clientY: number }) => { const r = viewport.current!.getBoundingClientRect(); return { x: e.clientX - r.left, y: e.clientY - r.top }; };
 useEffect(() => {
  const el = viewport.current;
  if (!el) return;
  const wheel = (e: WheelEvent) => { e.preventDefault(); setCamera(worldCameraZoomAt(camera.current, Math.exp(-e.deltaY * (e.ctrlKey ? 0.01 : 0.0015)), local(e), WORLD, size.current, MAX_ZOOM)); paint(16); };
  el.addEventListener("wheel", wheel, { passive: false });
  return () => el.removeEventListener("wheel", wheel);
 }, [setCamera, paint]);
 const stopFollow = () => setFollow(null);
 const zoomBy = (factor: number) => { setCamera(worldCameraZoomAt(camera.current, factor, { x: size.current.width / 2, y: size.current.height / 2 }, WORLD, size.current, MAX_ZOOM)); paint(16); };
 const fit = () => { stopFollow(); setCamera(worldCameraFit(WORLD, size.current)); paint(16); };
 const followActor = (id: string | null) => { setFollow(id); if (id) waves.current.set(id, performance.now() + 1600); };
 const onKey = (e: KeyboardEvent) => {
  const pan = (dx: number, dy: number) => { stopFollow(); setCamera(worldCameraPan(camera.current, dx, dy, WORLD, size.current, MAX_ZOOM)); paint(16); };
  const k = e.key;
  if (k === "ArrowLeft") pan(60, 0); else if (k === "ArrowRight") pan(-60, 0); else if (k === "ArrowUp") pan(0, 60); else if (k === "ArrowDown") pan(0, -60);
  else if (k === "+" || k === "=") zoomBy(1.25); else if (k === "-" || k === "_") zoomBy(0.8); else if (k === "0") fit();
  else if (k === "f" || k === "F") { const i = actors.findIndex(a => a.id === follow); followActor(actors[(i + 1) % actors.length]?.id ?? null); }
  else if (k === "Escape") stopFollow();
  else return;
  e.preventDefault();
 };
 const followName = actors.find(a => a.id === follow)?.name;
 const zoomPct = Math.round(zoom * 100);

 return <div className="hd-office" data-running={running} data-reduced={reduced || undefined}>
  <div ref={viewport} className="hd-office-viewport" tabIndex={0} role="application"
   aria-label="Living Universe HD office preview. Drag or use arrow keys to pan, plus and minus to zoom, 0 to fit the room, F to follow the next character, Escape to stop following."
   onKeyDown={onKey}
   onPointerDown={e => { viewport.current?.setPointerCapture?.(e.pointerId); pointers.current.set(e.pointerId, local(e)); dragged.current = 0; downOn.current = (e.target as HTMLElement).closest<HTMLElement>("[data-actor]")?.dataset["actor"] ?? null; }}
   onPointerMove={e => {
    const before = pointers.current.get(e.pointerId); if (!before) return;
    const prev = [...pointers.current.values()], now = local(e);
    pointers.current.set(e.pointerId, now);
    if (pointers.current.size === 1) { dragged.current += Math.hypot(now.x - before.x, now.y - before.y); if (dragged.current > 6) { stopFollow(); setCamera(worldCameraPan(camera.current, now.x - before.x, now.y - before.y, WORLD, size.current, MAX_ZOOM)); paint(16); } }
    else if (pointers.current.size === 2) { dragged.current = 99; stopFollow(); const after = [...pointers.current.values()]; setCamera(worldCameraPinch(camera.current, [prev[0]!, prev[1]!], [after[0]!, after[1]!], WORLD, size.current, MAX_ZOOM)); paint(16); }
   }}
   onPointerUp={e => { pointers.current.delete(e.pointerId); if (dragged.current <= 6 && downOn.current) followActor(downOn.current); downOn.current = null; }}
   onPointerCancel={e => { pointers.current.delete(e.pointerId); downOn.current = null; }}
   onDoubleClick={e => { setCamera(worldCameraZoomAt(camera.current, 1.6, local(e), WORLD, size.current, MAX_ZOOM)); paint(16); }}>
   <div ref={worldLayer} className="hd-office-world" style={{ width: W, height: H }}>
    <div className="hd-office-env" dangerouslySetInnerHTML={{ __html: ENVIRONMENT() }} />
    {actors.map(a => {
     const v = visuals[a.id] ?? { facing: "s" as Heading, motion: "idle" as PalMotion, walking: false, frame: 0 };
     return <div key={a.id} ref={el => { if (el) actorEls.current.set(a.id, el); else actorEls.current.delete(a.id); }} className="hd-actor" data-actor={a.id}
      data-art={a.art.kind === "synthetic" && !synthetic ? "native" : a.art.kind} data-real={real.current.get(a.id) ?? undefined} style={{ width: ACTOR, height: ACTOR } as CSSProperties}>
      <ActorVisual info={a} visual={v} synthetic={synthetic} measured={measured[a.id] ?? null} />
     </div>;
    })}
   </div>
   <div className="hd-office-labels" aria-hidden="true">
    {actors.map(a => {
     const r = real.current.get(a.id);
     return <div key={a.id} ref={el => { if (el) tagEls.current.set(a.id, el); else tagEls.current.delete(a.id); }} className={"hd-tag" + (follow === a.id ? " hd-tag-followed" : "")}>
      <span>{a.name}</span>{r && <b className="hd-tag-real">{REAL_TEXT[r]}</b>}
     </div>;
    })}
   </div>
   <div className="hd-office-badge" aria-hidden="true">HD preview{synthetic ? " · synthetic placeholders" : ""}</div>
  </div>
  <div className="hd-office-toolbar" role="toolbar" aria-label="Room camera">
   <button type="button" onClick={fit}>Fit room</button>
   <button type="button" onClick={() => zoomBy(0.8)} aria-label="Zoom out">−</button>
   <span className="hd-zoom" aria-live="off">{zoomPct}%</span>
   <button type="button" onClick={() => zoomBy(1.25)} aria-label="Zoom in">+</button>
   <label><span className="hd-follow-label">Follow</span> <select aria-label="Follow a character" value={follow ?? ""} onChange={e => followActor(e.target.value || null)}>
    <option value="">Nobody</option>{actors.map(a => <option key={a.id} value={a.id}>{a.name}</option>)}</select></label>
  </div>
  <ul className="sr-only" aria-label="Who is in the room">
   {actors.map(a => <li key={a.id}>{a.name}: {describe[a.id] ?? ""}</li>)}
  </ul>
  <div className="sr-only" aria-live="polite">{followName ? `Following ${followName}` : ""}</div>
 </div>;
}
// Exported for tests.
export const hdOfficeTestHooks = { screenToWorld };

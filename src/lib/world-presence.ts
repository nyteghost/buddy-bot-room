import { useEffect, useRef, useState, useSyncExternalStore } from "react";
import type { Heading } from "./office-motion";
import { worldHeadingOf, worldScreenDistance, type WorldPoint } from "./world-floor";

/**
 * In-memory, per-tab cosmetic state shared by Living World actors: who is standing where (for greetings)
 * and which furniture is in use (for glows). Nothing is persisted, sent anywhere or given to an AI.
 */
export type WorldBox = Readonly<{ w: number; h: number }>;
export type WorldRect = Readonly<{ l: number; t: number; r: number; b: number }>;
export type WorldPresence = Readonly<{ id: string; x: number; y: number; dwelling: boolean; at: number;
 /** On-screen sizes in css px (sprite above the feet, label below), for label collision checks. */
 sprite?: WorldBox; label?: WorldBox;
 /** Measured on-screen boxes relative to the room (css px); preferred over sizes when present. */
 spriteRect?: WorldRect; labelRect?: WorldRect }>;
const presence = new Map<string, WorldPresence>();
export const WORLD_GREETING_RADIUS = 11;
const STALE_MS = 1500;

export function publishWorldPresence(entry: WorldPresence): void { presence.set(entry.id, entry); }
export function clearWorldPresence(id: string): void { presence.delete(id); }
export function worldPresenceSnapshot(): WorldPresence[] { return [...presence.values()]; }

export type WorldGreeting = Readonly<{ partner: string; facing: Heading }>;
/**
 * A standing actor turns to chat with the nearest other standing actor nearby. Pure: pass the snapshot.
 * Both partners pick each other symmetrically, so they face one another.
 */
export function worldGreeting(self: WorldPresence, others: readonly WorldPresence[], now: number): WorldGreeting | null {
 if (!self.dwelling) return null;
 let best: WorldPresence | null = null, bestDistance = Infinity;
 for (const other of others) {
  if (other.id === self.id || !other.dwelling || now - other.at > STALE_MS) continue;
  const distance = worldScreenDistance(self as WorldPoint, other as WorldPoint);
  if (distance <= WORLD_GREETING_RADIUS && (distance < bestDistance || (distance === bestDistance && best && other.id < best.id))) { best = other; bestDistance = distance; }
 }
 if (!best) return null;
 return { partner: best.id, facing: best.x === self.x && best.y === self.y ? "s" : worldHeadingOf(best.x - self.x, best.y - self.y) };
}

const users = new Map<string, Set<string>>();
const listeners = new Set<() => void>();
let version = 0;
const emit = () => { version++; listeners.forEach(listener => listener()); };
const slot = (theme: string, fixture: string) => theme + ":" + fixture;
export function worldFixtureInUse(theme: string, fixture: string): boolean { return (users.get(slot(theme, fixture))?.size ?? 0) > 0; }
export function setWorldFixtureUse(actor: string, theme: string, fixture: string | undefined | null): void {
 const wanted = fixture ? slot(theme, fixture) : null;
 if (wanted && users.get(wanted)?.has(actor) && [...users].every(([key, set]) => key === wanted || !set.has(actor))) return;
 let changed = false;
 for (const [key, set] of users) if (set.delete(actor)) { changed = true; if (!set.size) users.delete(key); }
 if (wanted) { const set = users.get(wanted) ?? new Set<string>(); set.add(actor); users.set(wanted, set); changed = true; }
 if (changed) emit();
}
/** Re-renders when any furniture use changes. */
export function useWorldFixtureVersion(): number {
 return useSyncExternalStore(listener => { listeners.add(listener); return () => listeners.delete(listener); }, () => version, () => 0);
}
/** Mark furniture as used by this actor while `fixture` is set; cleared on change or unmount. */
export function useWorldFixtureUse(actor: string, theme: string, fixture: string | undefined | null): void {
 useEffect(() => {
  setWorldFixtureUse(actor, theme, fixture);
  return () => setWorldFixtureUse(actor, theme, null);
 }, [actor, theme, fixture]);
}

type Rect = { l: number; t: number; r: number; b: number };
const overlaps = (a: Rect, b: Rect) => a.l < b.r && b.l < a.r && a.t < b.b && b.t < a.b;
/** Drawing order matches worldDepthZ: whole-percent depth, later/equal depth may draw on top. */
const depth = (p: WorldPresence) => Math.round(p.y);
/** A body at the same or nearer depth can cover a label; between labels, ties go to the larger id. */
const bodyCovers = (other: WorldPresence, self: WorldPresence) => depth(other) >= depth(self);
const labelCovers = (other: WorldPresence, self: WorldPresence) => depth(other) > depth(self) || (depth(other) === depth(self) && other.id > self.id);
/**
 * Pure: should this actor's name label be hidden because a nearer actor's body or label covers it?
 * Positions are feet points in percent of the scene; sizes are css px; scene is the room size in px.
 */
export function worldLabelCovered(self: WorldPresence, others: readonly WorldPresence[], scene: WorldBox, now: number): boolean {
 if ((!self.label && !self.labelRect) || scene.w <= 0 || scene.h <= 0) return false;
 const fx = (p: WorldPresence) => p.x / 100 * scene.w, fy = (p: WorldPresence) => p.y / 100 * scene.h;
 const labelOf = (p: WorldPresence): Rect | null => p.labelRect ?? (p.label ? { l: fx(p) - p.label.w / 2, r: fx(p) + p.label.w / 2, t: fy(p) + 2, b: fy(p) + 2 + p.label.h } : null);
 // Only the solid middle of a sprite counts: transparent margins around the figure don't hide labels.
 const bodyOf = (p: WorldPresence): Rect | null => {
  if (p.spriteRect) { const w = p.spriteRect.r - p.spriteRect.l, c = (p.spriteRect.l + p.spriteRect.r) / 2; return { l: c - w * 0.35, r: c + w * 0.35, t: p.spriteRect.t, b: p.spriteRect.b }; }
  return p.sprite ? { l: fx(p) - p.sprite.w * 0.35, r: fx(p) + p.sprite.w * 0.35, t: fy(p) - p.sprite.h, b: fy(p) } : null;
 };
 const mine = labelOf(self);
 if (!mine) return false;
 for (const other of others) {
  if (other.id === self.id || now - other.at > STALE_MS) continue;
  const body = bodyOf(other);
  if (body && bodyCovers(other, self) && overlaps(mine, body)) return true;
  const theirs = labelOf(other);
  if (theirs && labelCovers(other, self) && overlaps(mine, theirs)) return true;
 }
 return false;
}
const HOLD_MS = 700;
/**
 * Browser hook: publish this actor's position and measured sizes, and report whether its name label
 * should be hidden (with a short hold so labels do not flicker as characters pass).
 */
export function useWorldActor(id: string, x: number, y: number, dwelling: boolean, enabled: boolean, tick: unknown) {
 const rootRef = useRef<HTMLElement | null>(null), labelRef = useRef<HTMLElement | null>(null);
 const [hidden, setHidden] = useState(false);
 const until = useRef(0);
 useEffect(() => {
  if (!enabled) { clearWorldPresence(id); setHidden(false); return; }
  const root = rootRef.current, label = labelRef.current, scene = root?.closest(".room-scene");
  const origin = scene?.getBoundingClientRect();
  const rect = (element: HTMLElement): WorldRect => { const box = element.getBoundingClientRect(); return { l: box.left - origin!.left, t: box.top - origin!.top, r: box.right - origin!.left, b: box.bottom - origin!.top }; };
  // Depth from the measured feet when available, so centre-anchored office Pals sort correctly too.
  const spriteRect = root && origin ? rect(root) : undefined;
  const entry: WorldPresence = { id, x, y: spriteRect && scene && scene.clientHeight ? spriteRect.b / scene.clientHeight * 100 : y, dwelling, at: Date.now(),
   ...(root ? { sprite: { w: root.offsetWidth, h: root.offsetHeight } } : {}),
   ...(label ? { label: { w: label.offsetWidth, h: label.offsetHeight } } : {}),
   ...(spriteRect ? { spriteRect } : {}), ...(label && origin ? { labelRect: rect(label) } : {}) };
  publishWorldPresence(entry);
  const now = Date.now();
  if (scene && worldLabelCovered(entry, worldPresenceSnapshot(), { w: scene.clientWidth, h: scene.clientHeight }, now)) until.current = now + HOLD_MS;
  setHidden(until.current > now);
 }, [id, x, y, dwelling, enabled, tick]);
 useEffect(() => () => clearWorldPresence(id), [id]);
 return { rootRef, labelRef, labelHidden: hidden };
}

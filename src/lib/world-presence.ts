import { useEffect, useSyncExternalStore } from "react";
import type { Heading } from "./office-motion";
import { worldHeadingOf, worldScreenDistance, type WorldPoint } from "./world-floor";

/**
 * In-memory, per-tab cosmetic state shared by Living World actors: who is standing where (for greetings)
 * and which furniture is in use (for glows). Nothing is persisted, sent anywhere or given to an AI.
 */
export type WorldPresence = Readonly<{ id: string; x: number; y: number; dwelling: boolean; at: number }>;
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

import { MAX_ACTIVE_VISITORS, type WorldCustomCharacter } from "./world-custom-packs";
import { greenJacketPalette, greenJacketSprite, worldCharacterPacks } from "./world-character-packs";
import { guestIds, guestPalette, guestSprite, type GuestId } from "./world-guest-packs";

/** A built-in guest in the shape the HD office draws (its own pixel art; no identity, memory or permissions). */
export type WorldHdVisitor = WorldCustomCharacter & { builtIn?: true };

const builtInCache = new Map<string, WorldHdVisitor>();
/** The built-in visitor packs as HD-office visitors (stable objects, so React and the crowd see the same actor). */
export function worldBuiltInVisitor(id: string): WorldHdVisitor | null {
 const cached = builtInCache.get(id);
 if (cached) return cached;
 const pack = worldCharacterPacks.find(p => p.id === id);
 let made: WorldHdVisitor | null = null;
 if (pack && id === "green-jacket") made = { id, name: pack.name, pixels: greenJacketSprite(), palette: greenJacketPalette, builtIn: true };
 else if (pack && (guestIds as readonly string[]).includes(id)) made = { id, name: pack.name, pixels: guestSprite(id as GuestId), palette: guestPalette, builtIn: true };
 if (made) builtInCache.set(id, made);
 return made;
}

/**
 * Who visits the HD office: every enabled visitor, built-in or custom, in the order they were enabled,
 * at most six (the same limit as the Living World). A custom character used as a Pal's look is drawn as
 * that Pal, never as a second visitor. Unknown or deleted ids are skipped.
 */
export function worldHdVisitors(enabled: readonly string[], custom: readonly WorldCustomCharacter[], palLookIds: ReadonlySet<string>): WorldHdVisitor[] {
 const out: WorldHdVisitor[] = [], seen = new Set<string>();
 for (const id of enabled) {
  if (seen.has(id) || palLookIds.has(id)) continue;
  const visitor = worldBuiltInVisitor(id) ?? custom.find(c => c.id === id) ?? null;
  if (!visitor) continue;
  seen.add(id); out.push(visitor);
  if (out.length >= MAX_ACTIVE_VISITORS) break;
 }
 return out;
}

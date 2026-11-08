import { isWorldHeightClass, type WorldHeightClass } from "@/lib/world-scale";
/** Cosmetic HD animation data. These records carry no executable or AI permissions. */
export const WORLD_HD_DIRECTIONS = ["s", "se", "e", "ne", "n", "nw", "w", "sw"] as const;
export const WORLD_HD_ACTIONS = ["idle", "walk", "run", "turn", "talk", "wave", "celebrate", "emote", "signature", "rest", "interaction"] as const;
export const WORLD_HD_MOVEMENTS = ["humanoid", "quadruped", "flying", "floating", "rolling"] as const;
export const WORLD_HD_MAX_FRAMES = 512;
export const WORLD_HD_MAX_CLIP_FRAMES = 32;
export const WORLD_HD_MAX_DATA_CHARS = 32 * 1024 * 1024;
export const WORLD_HD_PNG_BYTES = 520_000;
export type WorldHdDirection = typeof WORLD_HD_DIRECTIONS[number];
export type WorldHdAction = typeof WORLD_HD_ACTIONS[number];
export type WorldHdFrame = { src: string; durationMs: number };
export type WorldHdClip = { frames: WorldHdFrame[]; loop: boolean };
export type WorldHdCharacter = {
 version: number;
 artStatus: "prototype" | "production-approved";
 description?: string;
 movement: typeof WORLD_HD_MOVEMENTS[number];
 /** Optional declared in-room height (world-scale.ts); absent = standard adult. */
 height?: WorldHeightClass;
 directions: Partial<Record<WorldHdDirection, Partial<Record<WorldHdAction, WorldHdClip>>>>;
};
export const worldHdAssetReference = (value: unknown): value is string =>
 typeof value === "string" && /^\/api\/character-universe\?asset=[a-f0-9]{64}$/.test(value);
const record = (value: unknown): value is Record<string, unknown> =>
 !!value && typeof value === "object" && !Array.isArray(value);
const keys = (value: Record<string, unknown>, allowed: readonly string[]) =>
 Object.keys(value).every(key => allowed.includes(key));
const crcTable = Array.from({ length: 256 }, (_, index) => {
 let value = index;
 for (let bit = 0; bit < 8; bit++) value = value & 1 ? 0xedb88320 ^ (value >>> 1) : value >>> 1;
 return value >>> 0;
});
function crc32(bytes: Uint8Array): number {
 let value = 0xffffffff;
 for (const byte of bytes) value = crcTable[(value ^ byte) & 255]! ^ (value >>> 8);
 return (value ^ 0xffffffff) >>> 0;
}
/** Validate a complete noninterlaced 8-bit 256px PNG, including chunk CRCs and transparency support. */
export function validWorldHdPng(bytes: Uint8Array): boolean {
 if (bytes.length < 57 || bytes.length > WORLD_HD_PNG_BYTES ||
  ![137, 80, 78, 71, 13, 10, 26, 10].every((byte, index) => bytes[index] === byte)) return false;
 const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
 let offset = 8, hasData = false, dataEnded = false, hasPalette = false, transparent = false, color = -1;
 while (offset + 12 <= bytes.length) {
  const size = view.getUint32(offset);
  if (size > bytes.length - offset - 12) return false;
  const type = String.fromCharCode(...bytes.subarray(offset + 4, offset + 8));
  if (!/^[A-Za-z]{4}$/.test(type) || crc32(bytes.subarray(offset + 4, offset + 8 + size)) !== view.getUint32(offset + 8 + size)) return false;
  if (offset === 8) {
   if (type !== "IHDR" || size !== 13 || view.getUint32(16) !== 256 || view.getUint32(20) !== 256 ||
    bytes[24] !== 8 || ![2, 3, 4, 6].includes(bytes[25]!) || bytes[26] !== 0 || bytes[27] !== 0 || bytes[28] !== 0) return false;
   color = bytes[25]!;
   transparent = color === 4 || color === 6;
  } else if (type === "IHDR") return false;
  if (type === "PLTE") {
   if (hasData || hasPalette || size < 3 || size > 768 || size % 3 !== 0) return false;
   hasPalette = true;
  }
  if (type === "tRNS") {
   if (hasData || (color === 3 && (!hasPalette || size < 1 || size > 256)) || (color === 2 && size !== 6) || ![2, 3].includes(color)) return false;
   transparent = true;
  }
  if (type === "IDAT") {
   if (dataEnded || (color === 3 && !hasPalette)) return false;
   hasData = true;
  } else if (hasData) dataEnded = true;
  if (type === "IEND") return size === 0 && hasData && transparent && offset + 12 === bytes.length;
  // Unknown critical chunks and animated PNG streams are outside the sprite format.
  if (!["IHDR", "PLTE", "IDAT", "IEND"].includes(type) && (/^[A-Z]/.test(type) || ["acTL", "fcTL", "fdAT"].includes(type))) return false;
  offset += size + 12;
 }
 return false;
}
export function worldHdPngBytes(value: unknown): Uint8Array | null {
 if (typeof value !== "string" || !value.startsWith("data:image/png;base64,") || value.length > 700_000) return null;
 const raw = value.slice(22);
 if (raw.length % 4 !== 0 || !/^[A-Za-z0-9+/]+={0,2}$/.test(raw)) return null;
 try {
  const decoded = atob(raw);
  const bytes = Uint8Array.from(decoded, char => char.charCodeAt(0));
  return validWorldHdPng(bytes) ? bytes : null;
 } catch { return null; }
}
export function validateWorldHdCharacter(raw: unknown): WorldHdCharacter | null {
 if (!record(raw) || !keys(raw, ["version", "artStatus", "description", "movement", "height", "directions"]) ||
  !Number.isSafeInteger(raw["version"]) || Number(raw["version"]) < 1 || Number(raw["version"]) > 1_000_000 ||
  !["prototype", "production-approved"].includes(String(raw["artStatus"])) ||
  !WORLD_HD_MOVEMENTS.includes(raw["movement"] as WorldHdCharacter["movement"]) ||
  (raw["height"] !== undefined && !isWorldHeightClass(raw["height"])) ||
  (raw["description"] !== undefined && (typeof raw["description"] !== "string" || raw["description"].length > 1200 || /[\x00-\x1f<>]/.test(raw["description"]))) ||
  !record(raw["directions"]) || !keys(raw["directions"], WORLD_HD_DIRECTIONS)) return null;
 const directions: WorldHdCharacter["directions"] = {};
 let count = 0, dataChars = 0;
 const verified = new Set<string>();
 for (const [direction, source] of Object.entries(raw["directions"])) {
  if (!record(source) || !keys(source, WORLD_HD_ACTIONS) || !source["idle"]) return null;
  const actions: Partial<Record<WorldHdAction, WorldHdClip>> = {};
  for (const [action, clip] of Object.entries(source)) {
   if (!record(clip) || !keys(clip, ["frames", "loop"]) || typeof clip["loop"] !== "boolean" ||
    !Array.isArray(clip["frames"]) || clip["frames"].length < 1 || clip["frames"].length > WORLD_HD_MAX_CLIP_FRAMES) return null;
   const frames: WorldHdFrame[] = [];
   for (const frame of clip["frames"]) {
    if (!record(frame) || !keys(frame, ["src", "durationMs"]) || typeof frame["src"] !== "string" ||
     !Number.isSafeInteger(frame["durationMs"]) || Number(frame["durationMs"]) < 40 || Number(frame["durationMs"]) > 10_000) return null;
    if (++count > WORLD_HD_MAX_FRAMES) return null;
    if (!verified.has(frame["src"])) {
     if (!worldHdAssetReference(frame["src"]) && !worldHdPngBytes(frame["src"])) return null;
     dataChars += frame["src"].length;
     if (dataChars > WORLD_HD_MAX_DATA_CHARS) return null;
     verified.add(frame["src"]);
    }
    frames.push({ src: frame["src"], durationMs: Number(frame["durationMs"]) });
   }
   actions[action as WorldHdAction] = { frames, loop: clip["loop"] };
  }
  directions[direction as WorldHdDirection] = actions;
 }
 if (!directions.s?.idle) return null;
 if (raw["artStatus"] === "production-approved" && WORLD_HD_DIRECTIONS.some(direction => !directions[direction]?.idle)) return null;
 return { version: Number(raw["version"]), artStatus: raw["artStatus"] as WorldHdCharacter["artStatus"],
  movement: raw["movement"] as WorldHdCharacter["movement"], directions,
  ...(raw["height"] === undefined ? {} : { height: raw["height"] as WorldHeightClass }),
  ...(raw["description"] === undefined ? {} : { description: raw["description"] as string }) };
}

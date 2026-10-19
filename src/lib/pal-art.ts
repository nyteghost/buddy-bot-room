import type { AgentId } from "./agents";
import type { CharacterMode } from "./hellraiser";

// Hand-drawn 128×128 pixel-art portraits, one per pal per theme (Assistant shares Linux art).
const files = import.meta.glob("../assets/pals/*.png", { eager: true, import: "default" }) as Record<string, string>;

export function palArt(id: AgentId, mode: CharacterMode): string | undefined {
  const theme = mode === "assistant" ? "linux" : mode;
  return files[`../assets/pals/${theme}-${id}.png`];
}

// Saiyan ships real art for all eight facing directions (64×64, exported from Pixel Lab).
const facingFiles = import.meta.glob("../assets/pals/saiyan/*.png", { eager: true, import: "default" }) as Record<string, string>;
const FACING_NAMES = { n: "north", ne: "north-east", e: "east", se: "south-east", s: "south", sw: "south-west", w: "west", nw: "north-west" } as const;
export type Facing = keyof typeof FACING_NAMES;
/** Pals with a frame per direction. Others use one portrait (mirrored for left/right in the office). */
export const hasFacingArt = (id: AgentId): boolean => id === "saiyan";
export function facingArt(id: AgentId, facing: Facing = "s"): string | undefined {
  return hasFacingArt(id) ? facingFiles[`../assets/pals/saiyan/${FACING_NAMES[facing]}.png`] : undefined;
}

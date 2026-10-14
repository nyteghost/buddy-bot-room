import type { AgentId } from "./agents";
import type { CharacterMode } from "./hellraiser";

// Hand-drawn 128×128 pixel-art portraits, one per pal per theme (Assistant shares Linux art).
const files = import.meta.glob("../assets/pals/*.png", { eager: true, import: "default" }) as Record<string, string>;

export function palArt(id: AgentId, mode: CharacterMode): string | undefined {
  const theme = mode === "assistant" ? "linux" : mode;
  return files[`../assets/pals/${theme}-${id}.png`];
}

import { useMemo } from "react";
import { PalArtRig } from "./pal-art-rig";
import type { PalMotion } from "@/lib/pal-motion";
import { cn } from "@/lib/utils";
import type { AgentId } from "@/lib/agents";
import { useCharacterMode, type CharacterMode } from "@/lib/hellraiser";
import { characterSprite } from "@/lib/character-sprites";
import { spriteRuns, to128 } from "@/lib/sprite-upscale";
import { facingArt, hasFacingArt, palArt, type Facing } from "@/lib/pal-art";
import { worldFacingSprite } from "@/lib/world-facing-sprites";

export function PixelCharacter({
  id,
  className,
  animated = false,
  walking = false,
  back = false,
  facing,
  mode: explicitMode,
  motion,
  pixelWorld = false,
  walkFrame = 0,
}: {
  id: AgentId;
  className?: string;
  animated?: boolean;
  walking?: boolean;
  /** Seen from behind (seated facing a monitor): face pixels become hair. */
  back?: boolean;
  /** Which way the pal faces. Only pals with directional art (Saiyan) use it; the default is facing the viewer. */
  facing?: Facing | undefined;
  mode?: CharacterMode;
  motion?: PalMotion | undefined;
  pixelWorld?: boolean;
  walkFrame?: number;
}) {
  const currentMode = useCharacterMode();
  const mode = explicitMode ?? currentMode;
  const directional = hasFacingArt(id) ? facingArt(id, facing ?? "s") : undefined;
  const art = pixelWorld ? undefined : directional ?? (back ? undefined : palArt(id, mode));
  const pose = walking ? "walk" : animated ? "talk" : motion;
  // Preserve the original portrait path while caching the much smaller native
  // 32px walking art. No 128px grid regeneration on every movement tick.
  const runs = useMemo(() => {
    if (art) return [];
    const front = characterSprite(id, mode);
    const source = pixelWorld ? worldFacingSprite(front, facing ?? (back ? "n" : "s"), walking ? walkFrame : 0, id === "mimic") : back ? backView(front) : front;
    const grid = pixelWorld ? source : to128(source);
    const feetY = pixelWorld ? 24 : 96;
    const middleX = pixelWorld ? 16 : 64;
    return spriteRuns(grid, (x, y) => y < feetY ? "body" : x < middleX ? "left-leg" : "right-leg");
  }, [art, id, mode, pixelWorld, facing, back, walking, walkFrame]);
  if (art && pose) return <PalArtRig id={id} art={art} motion={pose} className={cn("pixel-character native-sprite pal-art", directional && "pal-directional", `agent-${id}`, className)} />;
  if (art) {
    return (
      <img
        src={art}
        width={directional ? 64 : 128}
        height={directional ? 64 : 128}
        alt={`${id} pixel character`}
        draggable={false}
        className={cn("pixel-character native-sprite pal-art", directional && "pal-directional", `agent-${id}`, animated && "character-bounce", walking && "pal-art-walk", className)}
      />
    );
  }
  return (
    <svg
      viewBox={pixelWorld ? "0 0 32 32" : "0 0 128 128"}
      role="img"
      data-world-motion={pixelWorld ? pose ?? "idle" : undefined}
      aria-label={`${id} pixel character`}
      className={cn(
        "pixel-character native-sprite",
        pixelWorld && "world-native-sprite",
        `agent-${id}`,
        animated && "character-bounce",
        mode === "hellraiser" && "cenobite",
        mode === "horror" && "horror-icon",
        (mode === "matrix" || mode === "finalfantasy" || mode === "devteam" || mode === "cyberpunk" || mode === "linux" || mode === "assistant" || mode === "dcc") && "cinematic-sprite",
        className,
      )}
      shapeRendering="crispEdges"
    >
      {["body", "left-leg", "right-leg"].map((part) => <g key={part} className={walking ? `sprite-walk-${part}` : undefined}>{runs
        .filter((r) => r.part === part)
        .map((r) => <rect key={`${r.x}-${r.y}`} className={`sprite-${r.c}`} x={r.x} y={r.y} width={r.w} height="1" />)}</g>)}
    </svg>
  );
}

/** Turn a front sprite into a back view: the head becomes a solid hair silhouette. */
export function backView(grid: string[]): string[] {
  const counts = new Map<string, number>();
  for (const row of grid.slice(0, 5)) for (const p of row) if (p !== ".") counts.set(p, (counts.get(p) ?? 0) + 1);
  const hair = [...counts.entries()].sort((a, b) => b[1] - a[1])[0]?.[0] ?? "h";
  return grid.map((row, y) => (y < 17 ? row.replace(/[^.]/g, hair) : row));
}

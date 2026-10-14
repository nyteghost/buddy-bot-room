import { cn } from "@/lib/utils";
import type { AgentId } from "@/lib/agents";
import { useCharacterMode, type CharacterMode } from "@/lib/hellraiser";
import { characterSprite } from "@/lib/character-sprites";
import { spriteRuns, to128 } from "@/lib/sprite-upscale";

export function PixelCharacter({
  id,
  className,
  animated = false,
  walking = false,
  back = false,
  mode: explicitMode,
}: {
  id: AgentId;
  className?: string;
  animated?: boolean;
  walking?: boolean;
  /** Seen from behind (seated facing a monitor): face pixels become hair. */
  back?: boolean;
  mode?: CharacterMode;
}) {
  const currentMode = useCharacterMode();
  const mode = explicitMode ?? currentMode;
  const front = characterSprite(id, mode);
  const grid = to128(back ? backView(front) : front);
  const runs = spriteRuns(grid, (x, y) => (y < 96 ? "body" : x < 64 ? "left-leg" : "right-leg"));
  return (
    <svg
      viewBox="0 0 128 128"
      role="img"
      aria-label={`${id} pixel character`}
      className={cn(
        "pixel-character native-sprite",
        `agent-${id}`,
        animated && "character-bounce",
        mode === "hellraiser" && "cenobite",
        mode === "horror" && "horror-icon",
        (mode === "matrix" || mode === "finalfantasy" || mode === "devteam" || mode === "cyberpunk" || mode === "linux" || mode === "assistant") && "cinematic-sprite",
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

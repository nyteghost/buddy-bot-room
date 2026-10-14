import { cn } from "@/lib/utils";
import type { AgentId } from "@/lib/agents";
import { useCharacterMode, type CharacterMode } from "@/lib/hellraiser";
import { characterSprite } from "@/lib/character-sprites";

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
  const grid = back ? backView(front) : front;
  return (
    <svg
      viewBox="0 0 32 32"
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
      {["body", "left-leg", "right-leg"].map((part) => <g key={part} className={walking ? `sprite-walk-${part}` : undefined}>{grid.flatMap((row, y) =>
        [...row].map((pixel, x) =>
          pixel === "." || (y < 24 ? "body" : x < 16 ? "left-leg" : "right-leg") !== part ? null : (
            <rect
              key={`${x}-${y}`}
              className={`sprite-${pixel}`}
              x={x}
              y={y}
              width="1"
              height="1"
            />
          ),
        ),
      )}</g>)}
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

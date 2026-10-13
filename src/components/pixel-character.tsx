import { cn } from "@/lib/utils";
import type { AgentId } from "@/lib/agents";
import { useCharacterMode, type CharacterMode } from "@/lib/hellraiser";
import { characterSprite } from "@/lib/character-sprites";

export function PixelCharacter({
  id,
  className,
  animated = false,
  mode: explicitMode,
}: {
  id: AgentId;
  className?: string;
  animated?: boolean;
  mode?: CharacterMode;
}) {
  const currentMode = useCharacterMode();
  const mode = explicitMode ?? currentMode;
  const grid = characterSprite(id, mode);
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
        className,
      )}
      shapeRendering="crispEdges"
    >
      {grid.flatMap((row, y) =>
        [...row].map((pixel, x) =>
          pixel === "." ? null : (
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
      )}
    </svg>
  );
}

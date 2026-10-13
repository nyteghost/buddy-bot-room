import { cn } from "@/lib/utils";
import type { AgentId } from "@/lib/agents";

const patterns: Record<AgentId, string[]> = {
  nova: [
    "....aaaa....",
    "...aaaaaa...",
    "..aaaaaaaa..",
    "..aaeeeeaa..",
    "..aeeieiea..",
    "...eeeeee...",
    "....eeee....",
    "...aaaaaa...",
    "..aaaaaaaa..",
    ".eeaaaaaaee.",
    ".eeaaaaaaee.",
    "...aaaaaa...",
    "...aa..aa...",
    "...aa..aa...",
    "..ddd..ddd..",
  ],
  byte: [
    "....aaaa....",
    "...aaaaaa...",
    "..aaeeeeaa..",
    "..aeeeeeea..",
    "..aiieeiia..",
    "...eeeeee...",
    "....eeee....",
    "...aaaaaa...",
    "..aadaadaa..",
    "..aaaaaaaa..",
    ".eeaaaaaaee.",
    "...aaaaaa...",
    "...dd..dd...",
    "...dd..dd...",
    "..ddd..ddd..",
  ],
  sage: [
    ".....aa.....",
    "....aaaa....",
    "...aaaaaa...",
    "..aaaaaaaa..",
    "...eeeeee...",
    "...eieeie...",
    "...eeeeee...",
    "....eeee....",
    "...aaaaaa...",
    "..aaaaaaaa..",
    ".eeaaaaaaee.",
    "...aaaaaa...",
    "...dd..dd...",
    "...dd..dd...",
    "..ddd..ddd..",
  ],
  pip: [
    "...aaaaaa...",
    "..aaaaaaaa..",
    "..aaeaeaaa..",
    "...eeeeee...",
    "...eieeie...",
    "...eeeeee...",
    "....eeee....",
    "...aaaaaa...",
    "..aaaddaaa..",
    "..aaaaaaaa..",
    ".eeaaaaaaee.",
    "...aaaaaa...",
    "...dd..dd...",
    "...dd..dd...",
    "..ddd..ddd..",
  ],
};
export function PixelCharacter({
  id,
  className,
  animated = false,
}: {
  id: AgentId;
  className?: string;
  animated?: boolean;
}) {
  return (
    <svg
      viewBox="0 0 12 16"
      role="img"
      aria-label={`${id} pixel character`}
      className={cn("pixel-character", `agent-${id}`, animated && "character-bounce", className)}
      shapeRendering="crispEdges"
    >
      {patterns[id].flatMap((row, y) =>
        [...row].map((pixel, x) =>
          pixel === "." ? null : (
            <rect key={`${x}-${y}`} x={x} y={y} width="1" height="1" className={`pixel-${pixel}`} />
          ),
        ),
      )}
    </svg>
  );
}

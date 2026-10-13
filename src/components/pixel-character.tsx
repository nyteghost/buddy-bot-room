import { cn } from "@/lib/utils";
import type { AgentId } from "@/lib/agents";
import { useHellraiser } from "@/lib/hellraiser";

// w = pale flesh, g = pins/grid, b = black leather, r = blood, i = eyes, k = teeth
const cenobitePatterns: Record<AgentId, string[]> = {
  nova: [
    "...g.g.g....",
    "..gwgwgwg...",
    "..wgwgwgw...",
    "..gwgwgwg...",
    "..wiwgwiw...",
    "..gwgwgwg...",
    "...wwrww....",
    "....www.....",
    "..bbbbbbb...",
    ".bbgbbbgbb..",
    ".bbbbbbbbb..",
    ".wbbbbbbbw..",
    "..bbbbbbb...",
    "..bb...bb...",
    "..bb...bb...",
    ".bbb...bbb..",
  ],
  byte: [
    "...wwwwww...",
    "..wwwwwwww..",
    ".wwwrwwrwww.",
    ".wbbbwwbbbw.",
    ".wbbbwwbbbw.",
    ".wwwwwwwwww.",
    ".wrwwwwwwrw.",
    "..wwwwwwww..",
    ".bbbbbbbbbb.",
    "bbwwbbbbwwbb",
    "bbbbbbbbbbbb",
    "wbbbbbbbbbbw",
    ".bbbbbbbbbb.",
    "..bb....bb..",
    "..bb....bb..",
    ".bbb....bbb.",
  ],
  sage: [
    "....bbbb....",
    "...bwwwwb...",
    "...wwwwww...",
    "...wiwwiw...",
    "...wwwwww...",
    "....wrrw....",
    "....rgrr....",
    "....rggr....",
    "...bbbbbb...",
    "..bbbwwbbb..",
    "..bbbbbbbb..",
    ".wbbbbbbbbw.",
    "...bbbbbb...",
    "...bb..bb...",
    "...bb..bb...",
    "..bbb..bbb..",
  ],
  pip: [
    "...rwwwwr...",
    "..wrwrwrww..",
    "..wwiwwiww..",
    "..wrwrwrww..",
    "..kkkkkkkk..",
    "..krkrkrkk..",
    "..kkkkkkkk..",
    "....wwww....",
    "...bbbbbb...",
    "..bbgbbgbb..",
    "..bbbbbbbb..",
    ".wbbbbbbbbw.",
    "...bbbbbb...",
    "...bb..bb...",
    "...bb..bb...",
    "..bbb..bbb..",
  ],
};

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
  const hell = useHellraiser();
  const grid = hell ? cenobitePatterns[id] : patterns[id];
  return (
    <svg
      viewBox="0 0 12 16"
      role="img"
      aria-label={`${id} pixel character`}
      className={cn("pixel-character", `agent-${id}`, animated && "character-bounce", hell && "cenobite", className)}
      shapeRendering="crispEdges"
    >
      {grid.flatMap((row, y) =>
        [...row].map((pixel, x) =>
          pixel === "." ? null : (
            <rect key={`${x}-${y}`} x={x} y={y} width="1" height="1" className={`pixel-${pixel}`} />
          ),
        ),
      )}
    </svg>
  );
}

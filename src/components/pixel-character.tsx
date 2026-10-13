import { cn } from "@/lib/utils";
import type { AgentId } from "@/lib/agents";
import { useCharacterMode } from "@/lib/hellraiser";

// Pale masks, dark robes, hockey-mask markings and Freddy's striped sweater.
const horrorPatterns: Record<AgentId, string[]> = {
  nova: [
    "...bbbbbb...", "..bbwwwwbb..", "..bwwwwwwb..", "..bwiwwiwb..",
    "..bwiwwiwb..", "..bwwwwwwb..", "...bwiwb....", "...bwiwb....",
    "..bbbbbbbb..", ".bbbbbbbbbb.", ".bbbbbbbbbb.", ".bbbbbbbbbb.",
    "..bbbbbbbb..", "...bb..bb...", "...bb..bb...", "..bbb..bbb..",
  ],
  byte: [
    "....oooo....", "...owwwwo...", "..wwrwwrww..", "..wwiwwiww..",
    "..wwwwwwww..", "..wgwggwgw..", "...wwrrww...", "....wwww....",
    "...oooooo...", "..oooooooo..", ".woooooooow.", ".woooooooow.",
    "...oooooo...", "...bb..bb...", "...bb..bb...", "..bbb..bbb..",
  ],
  sage: [
    "....hhhh....", "...hhhhhh...", "..hhwwwwhh..", "..hwwwwwwh..",
    "..wwiwwiww..", "..wwwwwwww..", "...wwggww...", "....wwww....",
    "...nnnnnn...", "..nnnnnnnn..", ".wnnnnnnnnw.", ".wnnnnnnnnw.",
    "...nnnnnn...", "...nn..nn...", "...nn..nn...", "..bbb..bbb..",
  ],
  pip: [
    "....hhhh....", "...hhhhhh...", "..hhhhhhhh..", "...ttrttt...",
    "...tittit...", "...trttrt...", "....tttt....", "...rrrrrr...",
    "..oooooooo..", "..rrrrrrrr..", ".toooooooot.", ".trrrrrrrtg.",
    "...oooooo.gg", "...bb..bb.gg", "...bb..bb...", "..bbb..bbb..",
  ],
  echo: [
    "..rr....rr..", ".rrr.ww.rrr.", "..rwwwwwwr..", "..wiwwwwiw..",
    "..wwwrrwww..", "..wrwwwwrw..", "...wrrrrw...", "....wwww....",
    "...wwkkww...", "..wwkkkkww..", ".wwwwkkwwww.", ".kwwwwwwwwk.",
    "...wwwwww...", "...ww..ww...", "...ww..ww...", "..rrr..rrr..",
  ],
  rune: [
    "...rrrrrr...", "..rrrrrrrr..", "..rttttttr..", "..ttittitt..",
    "..trttttrt..", "..tttrrttt..", "...tttttt...", "....tttt....",
    "...nnwwnn...", "..nnnwwnnn..", ".tnnoonnnnt.", ".tnnoonnnnt.",
    "...nnnnnn...", "...nn..nn...", "...nn..nn...", "..rrr..rrr..",
  ],
};

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
  echo: [
    "...bbbbbb...", "..bbwwwwbb..", "..bwwwwwwb..", "..bwiwwiwb..",
    "..bwwwwwwb..", "...wwrrww...", "....wwww....", "...gbbbbg...",
    "..bbbrrbbb..", ".bbbrrrrbbb.", ".wbbbbbbbbw.", "..bbbbbbbb..",
    ".bbbbbbbbbb.", "..bb....bb..", "..bb....bb..", ".bbb....bbb.",
  ],
  rune: [
    "..gggggggg..", "..gwwwwwwg..", "..gwiwwiwg..", "..gwwwwwwg..",
    "..ggkkkkgg..", "...gwwwwg...", "....gggg....", "..gbbbbbbg..",
    ".gbbgbbgbbg.", ".bbbbbbbbbb.", "gbbbgggbbbbg", ".bbbbbbbbbb.",
    "..bbbbbbbb..", "..gb....bg..", "..bb....bb..", ".bbb....bbb.",
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
  echo: [
    "..aa....aa..", "..aaaaaaaa..", "..aaeeeeaa..", "..aeeeeeea..",
    "..aeieeiea..", "...eeeeee...", "....eeee....", "...aaaaaa...",
    "..aaaaaaaa..", ".eeaaaaaaee.", ".eeaaaaaaee.", "...aaaaaa...",
    "...dd..dd...", "...dd..dd...", "..ddd..ddd..",
  ],
  rune: [
    ".....a......", "....aaa.....", "...aaaaaa...", "..aaaaaaaa..",
    "..aeeeeeea..", "..eiieeiie..", "...eeeeee...", "....eeee....",
    "...aaaaaa...", "..adaaaada..", ".eeaaaaaaee.", "...aaaaaa...",
    "...dd..dd...", "...dd..dd...", "..ddd..ddd..",
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
  const mode = useCharacterMode();
  const hell = mode === "hellraiser";
  const grid = mode === "horror" ? horrorPatterns[id] : hell ? cenobitePatterns[id] : patterns[id];
  // Detailed rendering: each 12x16 source pixel becomes a beveled 3x3 block on
  // a 48x48 canvas — lit top/left edges, shadowed bottom/right, plain core —
  // for a sculpted, high-detail sprite look.
  return (
    <svg
      viewBox="0 0 48 48"
      role="img"
      aria-label={`${id} pixel character`}
      className={cn("pixel-character", `agent-${id}`, animated && "character-bounce", hell && "cenobite", mode === "horror" && "horror-icon", className)}
      shapeRendering="crispEdges"
    >
      {grid.flatMap((row, y) =>
        [...row].map((pixel, x) =>
          pixel === "." ? null : (
            <g key={`${x}-${y}`} className={`pixel-${pixel}`}>
              <rect className="shade-light" x={6 + x * 3} y={y * 3} width="1" height="1" />
              <rect className="shade-light" x={6 + x * 3 + 1} y={y * 3} width="1" height="1" />
              <rect x={6 + x * 3 + 2} y={y * 3} width="1" height="1" />
              <rect className="shade-light" x={6 + x * 3} y={y * 3 + 1} width="1" height="1" />
              <rect x={6 + x * 3 + 1} y={y * 3 + 1} width="1" height="1" />
              <rect className="shade-dark" x={6 + x * 3 + 2} y={y * 3 + 1} width="1" height="1" />
              <rect x={6 + x * 3} y={y * 3 + 2} width="1" height="1" />
              <rect className="shade-dark" x={6 + x * 3 + 1} y={y * 3 + 2} width="1" height="1" />
              <rect className="shade-dark" x={6 + x * 3 + 2} y={y * 3 + 2} width="1" height="1" />
            </g>
          ),
        ),
      )}
    </svg>
  );
}

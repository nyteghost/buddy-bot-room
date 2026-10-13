import type { AgentId } from "./agents";
import type { CharacterMode } from "./hellraiser";

// Every entry is a native pixel on a 32×32 canvas. No source-grid scaling.
export function characterSprite(id: AgentId, mode: CharacterMode): string[] {
  const grid = Array.from({ length: 32 }, () => Array<string>(32).fill("."));
  const dot = (x: number, y: number, c: string) => {
    if (grid[y] && x >= 0 && x < 32) grid[y][x] = c;
  };
  const box = (x: number, y: number, w: number, h: number, c: string) => {
    for (let j = y; j < y + h; j++) for (let i = x; i < x + w; i++) dot(i, j, c);
  };
  const oval = (x: number, y: number, w: number, h: number, c: string) => {
    for (let j = 0; j < h; j++)
      for (let i = 0; i < w; i++)
        if (((i + 0.5 - w / 2) / (w / 2)) ** 2 + ((j + 0.5 - h / 2) / (h / 2)) ** 2 <= 1)
          dot(x + i, y + j, c);
  };
  const eyes = (y: number, c = "i") => {
    box(12, y, 2, 2, c);
    box(19, y, 2, 2, c);
  };
  const leather = mode !== "normal";
  // Silhouette, jacket seams, individual hands, trouser folds and boot soles.
  box(11, 20, 5, 10, leather ? "b" : "d");
  box(17, 20, 5, 10, leather ? "b" : "d");
  box(10, 29, 6, 2, "i");
  box(17, 29, 6, 2, "i");
  box(12, 23, 1, 5, "g");
  box(18, 24, 1, 4, "g");
  oval(7, 13, 19, 13, "i");
  box(9, 15, 15, 9, leather ? "b" : "a");
  box(8, 16, 3, 8, leather ? "b" : "a");
  box(23, 16, 3, 8, leather ? "b" : "a");
  box(8, 23, 3, 3, "e");
  box(23, 23, 3, 3, "e");
  box(10, 16, 1, 6, "l");
  box(22, 17, 1, 6, "s");
  box(15, 17, 1, 7, "g");
  box(14, 12, 5, 4, "e");
  oval(9, 2, 15, 14, leather ? "w" : "e");
  box(10, 7, 1, 6, leather ? "g" : "t");
  eyes(8);
  dot(16, 10, "t");
  box(14, 13, 4, 1, "r");
  if (mode === "normal") {
    const hair = id === "sage" ? "g" : id === "pip" ? "q" : id === "rune" ? "i" : "h";
    oval(8, 1, 17, 7, hair);
    box(9, 6, 2, 4, hair);
    box(22, 5, 2, 5, hair);
    box(12, 2, 7, 1, "l");
    dot(11, 3, "l");
    dot(20, 4, "l");
    box(13, 7, 3, 1, hair);
    box(18, 7, 3, 1, hair);
    dot(12, 8, "k");
    dot(19, 8, "k");
    box(14, 16, 2, 2, "l");
    box(18, 16, 2, 2, "l");
    box(11, 24, 12, 1, "s");
    if (id === "nova") {
      box(8, 7, 2, 10, hair);
      box(23, 8, 2, 10, hair);
      box(18, 19, 3, 1, "k");
      dot(19, 18, "k");
      dot(19, 20, "k");
    }
    if (id === "byte" || id === "rune") {
      box(11, 8, 5, 4, "i");
      box(18, 8, 5, 4, "i");
      box(16, 9, 2, 1, "i");
      box(12, 9, 3, 1, "c");
      box(19, 9, 3, 1, "c");
    }
    if (id === "byte") {
      box(18, 19, 4, 3, "i");
      box(19, 20, 2, 1, "c");
      box(12, 16, 1, 6, "g");
    }
    if (id === "sage") {
      oval(13, 0, 7, 4, hair);
      box(13, 16, 7, 2, "l");
      box(18, 21, 5, 5, "h");
      box(19, 21, 1, 5, "k");
    }
    if (id === "pip") {
      box(9, 0, 3, 4, hair);
      box(18, 1, 3, 3, hair);
      box(13, 19, 7, 2, "k");
      dot(15, 18, "k");
      box(10, 7, 2, 2, "r");
    }
    if (id === "echo") {
      box(8, 6, 3, 12, hair);
      box(23, 6, 3, 12, hair);
      box(11, 16, 12, 2, "l");
      box(19, 18, 3, 5, "l");
      dot(10, 12, "q");
      dot(23, 12, "q");
    }
    if (id === "rune") {
      box(13, 0, 4, 4, hair);
      box(17, 1, 3, 3, hair);
      box(21, 18, 2, 4, "g");
      box(24, 22, 5, 2, "g");
      box(28, 20, 1, 5, "g");
    }
  } else if (mode === "horror") {
    if (id === "nova") {
      oval(7, 0, 19, 18, "b");
      oval(10, 2, 13, 15, "w");
      oval(11, 5, 4, 5, "i");
      oval(18, 5, 4, 5, "i");
      dot(15, 10, "g");
      dot(17, 10, "g");
      oval(14, 11, 5, 6, "i");
      box(14, 12, 1, 3, "g");
      box(7, 17, 2, 11, "b");
      box(24, 17, 2, 11, "b");
      box(11, 18, 1, 6, "g");
      box(21, 18, 1, 7, "g");
      box(24, 20, 5, 1, "g");
      dot(29, 20, "k");
    } else if (id === "byte") {
      oval(8, 1, 17, 16, "h");
      oval(9, 2, 15, 15, "w");
      box(11, 7, 4, 2, "i");
      box(18, 7, 4, 2, "i");
      dot(14, 4, "r");
      box(15, 5, 3, 1, "r");
      dot(18, 4, "r");
      dot(11, 10, "r");
      dot(12, 11, "r");
      dot(21, 10, "r");
      dot(20, 11, "r");
      for (const y of [4, 10, 12, 14]) for (const x of [12, 16, 20]) dot(x, y, "g");
      box(9, 17, 15, 7, "o");
      box(8, 17, 3, 6, "o");
      box(23, 17, 3, 6, "o");
      box(16, 17, 1, 7, "g");
      box(11, 19, 3, 2, "h");
      box(25, 19, 2, 11, "g");
      box(26, 21, 2, 8, "k");
    } else if (id === "sage") {
      oval(8, 0, 17, 10, "h");
      oval(10, 3, 13, 13, "w");
      box(11, 7, 4, 2, "i");
      box(18, 7, 4, 2, "i");
      box(16, 9, 1, 3, "g");
      box(14, 13, 5, 1, "g");
      box(9, 17, 15, 8, "n");
      box(8, 17, 3, 7, "n");
      box(23, 17, 3, 7, "n");
      box(15, 17, 1, 7, "g");
      box(11, 19, 3, 2, "g");
      box(18, 19, 3, 2, "g");
      box(11, 25, 5, 4, "n");
      box(17, 25, 5, 4, "n");
      box(26, 21, 1, 8, "k");
    } else if (id === "pip") {
      oval(9, 3, 15, 13, "t");
      eyes(7);
      box(10, 1, 13, 4, "h");
      box(7, 5, 19, 2, "h");
      box(11, 4, 12, 1, "i");
      for (const [x, y] of [
        [12, 10],
        [14, 6],
        [18, 10],
        [20, 12],
        [15, 13],
        [21, 6],
      ] as const) {
        dot(x, y, "r");
        dot(x + 1, y + 1, "r");
      }
      box(13, 13, 7, 1, "i");
      dot(14, 13, "k");
      dot(18, 13, "k");
      for (let y = 17; y < 24; y++) box(9, y, 15, 1, y % 4 < 2 ? "r" : "o");
      box(24, 22, 3, 3, "h");
      for (let x = 24; x < 28; x++) box(x, 17 - (x % 2), 1, 5, "g");
    } else if (id === "echo") {
      oval(5, 2, 9, 10, "r");
      oval(20, 2, 9, 10, "r");
      oval(10, 1, 13, 16, "w");
      eyes(7);
      dot(13, 6, "q");
      dot(19, 6, "q");
      oval(15, 9, 3, 3, "r");
      box(12, 13, 9, 2, "r");
      for (let x = 13; x < 21; x += 2) dot(x, 13, "k");
      for (const x of [12, 20]) {
        box(x, 9, 1, 4, "r");
        box(x, 4, 1, 3, "r");
      }
      box(9, 17, 15, 7, "w");
      box(8, 16, 17, 2, "k");
      box(15, 18, 3, 2, "r");
      box(15, 21, 3, 2, "r");
      box(28, 10, 1, 15, "g");
      oval(25, 1, 7, 10, "r");
      dot(27, 3, "l");
      box(10, 29, 6, 2, "r");
      box(17, 29, 6, 2, "r");
    } else if (id === "rune") {
      oval(8, 1, 17, 14, "r");
      oval(10, 4, 13, 12, "e");
      eyes(8, "c");
      dot(12, 8, "i");
      dot(19, 8, "i");
      box(9, 4, 3, 6, "r");
      box(22, 3, 3, 8, "r");
      box(12, 13, 8, 1, "i");
      dot(14, 13, "k");
      dot(19, 13, "k");
      dot(20, 5, "r");
      dot(21, 6, "r");
      dot(20, 7, "r");
      dot(21, 8, "r");
      box(9, 17, 15, 7, "n");
      box(10, 16, 3, 8, "c");
      box(20, 16, 3, 8, "c");
      for (let y = 18; y < 24; y += 2) box(13, y, 7, 1, "r");
      box(11, 25, 5, 4, "n");
      box(17, 25, 5, 4, "n");
      box(25, 20, 1, 8, "k");
    }
  } else {
    // Recognizable Cenobite face treatments, leather panels, clasps and chains.
    box(12, 18, 2, 5, "g");
    box(20, 18, 2, 5, "g");
    box(13, 24, 8, 1, "g");
    dot(16, 24, "q");
    if (id === "nova") {
      oval(9, 1, 15, 15, "w");
      eyes(8);
      for (const x of [11, 15, 19, 23]) for (let y = 3; y < 14; y++) dot(x, y, "g");
      for (const y of [4, 7, 11]) for (let x = 10; x < 24; x++) dot(x, y, "g");
      for (const x of [10, 14, 18, 22]) {
        box(x, 0, 1, 4, "g");
        dot(x, 0, "k");
        dot(x - 1, 1, "k");
      }
      for (const y of [5, 9, 13]) {
        box(7, y, 3, 1, "g");
        box(23, y, 3, 1, "g");
        dot(7, y, "k");
        dot(25, y, "k");
      }
      eyes(8);
      box(14, 13, 5, 1, "r");
      box(14, 16, 5, 3, "w");
    } else if (id === "byte") {
      oval(7, 1, 19, 16, "w");
      box(8, 7, 17, 1, "b");
      box(9, 6, 7, 4, "i");
      box(18, 6, 7, 4, "i");
      box(10, 7, 4, 1, "g");
      box(19, 7, 4, 1, "g");
      box(14, 13, 6, 1, "r");
      oval(6, 16, 22, 10, "b");
      oval(11, 17, 12, 6, "w");
      box(14, 21, 6, 1, "r");
      box(16, 18, 1, 3, "g");
      box(7, 17, 3, 6, "g");
      box(25, 17, 2, 6, "g");
    } else if (id === "sage") {
      box(9, 2, 2, 8, "b");
      box(23, 2, 2, 8, "b");
      box(10, 3, 13, 1, "g");
      eyes(7);
      box(14, 12, 6, 5, "r");
      box(14, 13, 6, 1, "i");
      box(13, 12, 1, 6, "g");
      box(20, 12, 1, 6, "g");
      box(13, 17, 8, 1, "g");
      box(13, 19, 8, 4, "w");
      box(16, 19, 2, 4, "r");
    } else if (id === "pip") {
      oval(9, 1, 15, 15, "t");
      box(10, 5, 13, 4, "r");
      box(11, 6, 11, 2, "g");
      oval(9, 9, 15, 8, "i");
      box(10, 10, 13, 2, "k");
      box(10, 14, 13, 2, "k");
      for (let x = 11; x < 23; x += 2) {
        dot(x, 11, "g");
        dot(x, 14, "g");
      }
      box(7, 10, 3, 1, "g");
      box(23, 10, 3, 1, "g");
      box(7, 15, 3, 1, "g");
      box(23, 15, 3, 1, "g");
    } else if (id === "echo") {
      oval(7, 0, 19, 9, "h");
      oval(10, 3, 13, 13, "w");
      box(8, 5, 2, 12, "r");
      box(24, 5, 2, 12, "r");
      box(10, 3, 1, 8, "r");
      box(22, 3, 1, 8, "r");
      eyes(7);
      box(12, 6, 3, 1, "i");
      box(18, 6, 3, 1, "i");
      box(14, 13, 5, 1, "r");
      box(14, 17, 5, 4, "w");
      box(13, 21, 7, 2, "r");
      box(16, 23, 1, 2, "r");
    } else {
      oval(6, 1, 22, 17, "t");
      box(9, 3, 15, 4, "g");
      box(11, 4, 11, 2, "i");
      oval(8, 8, 18, 9, "i");
      box(10, 9, 15, 2, "k");
      box(10, 14, 15, 2, "k");
      for (let x = 11; x < 25; x += 2) {
        dot(x, 10, "g");
        dot(x, 14, "g");
      }
      box(7, 18, 20, 5, "t");
      box(10, 19, 14, 3, "r");
      box(14, 20, 6, 1, "i");
      for (const x of [5, 27]) {
        box(x, 15, 2, 12, "t");
        box(x, 25, 3, 2, "g");
      }
    } else {
      // The Artificer: obsidian hood, geometric cuts and a brass puzzle box.
      oval(7, 0, 19, 17, "b");
      oval(10, 3, 13, 13, "w");
      eyes(8);
      for (let i = 0; i < 6; i++) {
        dot(11 + i, 4 + i, "g");
        dot(21 - i, 4 + i, "g");
      }
      box(16, 3, 1, 12, "g");
      box(13, 13, 7, 1, "r");
      box(9, 17, 15, 8, "b");
      box(15, 17, 3, 8, "g");
      box(23, 21, 5, 5, "q");
      box(24, 22, 3, 3, "k");
      dot(25, 23, "q");
    }
  }
  if (id === "claude" && mode === "normal") {
    // Claude: warm scholar with a starburst crest, monocle and quill.
    box(9, 15, 15, 9, "a");
    box(15, 15, 3, 9, "l");
    box(12, 7, 4, 4, "q");
    box(13, 8, 2, 2, "c");
    for (const [x, y] of [[16, 0], [16, 1], [14, 1], [18, 1], [16, 2], [15, 1], [17, 1]] as const) dot(x, y, "q");
    box(24, 14, 1, 9, "w");
    dot(25, 13, "w");
    dot(23, 15, "w");
  }
  if (id === "claude" && mode === "horror") {
    // Jigsaw's Billy puppet: chalk-white face, red spiral cheeks, black tux and red bow tie.
    oval(8, 0, 17, 9, "i");
    oval(10, 2, 13, 14, "w");
    box(11, 7, 4, 3, "i");
    box(18, 7, 4, 3, "i");
    dot(12, 8, "r");
    dot(19, 8, "r");
    for (const cx of [11, 20]) {
      box(cx, 11, 3, 1, "r");
      dot(cx, 12, "r");
      dot(cx + 2, 12, "r");
      box(cx, 13, 3, 1, "r");
      dot(cx + 1, 12, "w");
    }
    box(14, 13, 5, 1, "r");
    box(14, 14, 5, 1, "i");
    box(15, 15, 1, 2, "g");
    box(17, 15, 1, 2, "g");
    box(9, 17, 15, 8, "i");
    box(8, 17, 3, 7, "i");
    box(23, 17, 3, 7, "i");
    box(15, 17, 3, 7, "w");
    box(13, 17, 7, 2, "r");
    box(16, 17, 1, 2, "k");
    box(8, 23, 3, 3, "w");
    box(23, 23, 3, 3, "w");
    box(11, 20, 5, 10, "i");
    box(17, 20, 5, 10, "i");
  }
  return grid.map((row) => row.join(""));
}

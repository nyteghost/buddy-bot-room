/** Scale2x (EPX): doubles a pixel grid while rounding diagonal edges instead of blocky stair-steps. */
export function scale2x(grid: string[]): string[] {
  const h = grid.length;
  const w = grid[0]?.length ?? 0;
  const at = (x: number, y: number) => grid[Math.min(h - 1, Math.max(0, y))]![Math.min(w - 1, Math.max(0, x))]!;
  const out: string[] = [];
  for (let y = 0; y < h; y++) {
    let top = "", bottom = "";
    for (let x = 0; x < w; x++) {
      const p = at(x, y), a = at(x, y - 1), b = at(x + 1, y), c = at(x - 1, y), d = at(x, y + 1);
      let e0 = p, e1 = p, e2 = p, e3 = p;
      if (a !== d && c !== b) {
        if (c === a) e0 = c;
        if (a === b) e1 = b;
        if (d === c) e2 = c;
        if (b === d) e3 = d;
      }
      top += e0 + e1;
      bottom += e2 + e3;
    }
    out.push(top, bottom);
  }
  return out;
}

/** Native 32×32 art → 128×128 sprite grid. */
export function to128(grid: string[]): string[] {
  return scale2x(scale2x(grid));
}

/** Horizontal runs of one colour, so a 128×128 sprite stays light to draw. */
export function spriteRuns(grid: string[], part: (x: number, y: number) => string) {
  const runs: { x: number; y: number; w: number; c: string; part: string }[] = [];
  grid.forEach((row, y) => {
    let x = 0;
    while (x < row.length) {
      const c = row[x]!;
      const pt = part(x, y);
      let end = x + 1;
      while (end < row.length && row[end] === c && part(end, y) === pt) end++;
      if (c !== ".") runs.push({ x, y, w: end - x, c, part: pt });
      x = end;
    }
  });
  return runs;
}

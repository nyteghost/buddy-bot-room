import type { AgentId } from "./agents";

/** Hand-drawn silhouettes rasterized directly onto a native 32×32 canvas. */
export function themedSprite(id: AgentId, mode: "matrix" | "finalfantasy"): string[] {
  const grid = Array.from({ length: 32 }, () => Array<string>(32).fill("."));
  const dot = (x: number, y: number, c: string) => {
    if (grid[y] && x >= 0 && x < 32) grid[y][x] = c;
  };
  const box = (x: number, y: number, w: number, h: number, c: string) => {
    for (let j = y; j < y + h; j++) for (let i = x; i < x + w; i++) dot(i, j, c);
  };
  const line = (x: number, y: number, x2: number, y2: number, c: string) => {
    const steps = Math.max(Math.abs(x2 - x), Math.abs(y2 - y));
    for (let i = 0; i <= steps; i++) {
      const t = steps ? i / steps : 0;
      dot(Math.round(x + (x2 - x) * t), Math.round(y + (y2 - y) * t), c);
    }
  };
  const shape = (points: [number, number][], c: string) => {
    for (let y = 0; y < 32; y++) for (let x = 0; x < 32; x++) {
      let inside = false;
      for (let i = 0, j = points.length - 1; i < points.length; j = i++) {
        const a = points[i], b = points[j];
        if ((a[1] > y + .5) !== (b[1] > y + .5) && x + .5 < (b[0] - a[0]) * (y + .5 - a[1]) / (b[1] - a[1]) + a[0]) inside = !inside;
      }
      if (inside) dot(x, y, c);
    }
  };
  const head = (skin = "E", shadow = "T") => {
    shape([[11,4],[20,4],[23,7],[22,12],[19,15],[13,15],[10,12],[9,7]], "I");
    shape([[11,5],[20,5],[22,8],[21,12],[18,14],[14,14],[11,12],[10,8]], shadow);
    box(12,6,8,6,skin); box(13,11,6,2,skin);
    dot(10,10,skin); dot(21,10,skin);
    box(14,14,4,3,shadow); box(14,14,3,2,skin);
    dot(16,10,shadow); box(15,12,3,1,shadow);
  };
  const eyes = (color = "c") => {
    box(12,8,3,2,"I"); box(18,8,3,2,"I");
    dot(13,8,"K"); dot(19,8,"K"); dot(14,9,color); dot(20,9,color);
  };
  const shades = () => {
    box(11,8,5,3,"I"); box(18,8,5,3,"I"); box(16,9,2,1,"G");
    box(12,8,3,1,"G"); box(19,8,3,1,"G"); dot(12,9,"C"); dot(19,9,"C");
  };
  const legs = (color = "B") => {
    box(11,23,5,7,"I"); box(17,23,5,7,"I");
    box(12,24,3,5,color); box(18,24,3,5,color);
    box(12,25,1,3,"G"); box(18,26,1,2,"G");
    box(10,29,6,2,"I"); box(17,29,6,2,"I");
    box(11,29,3,1,"B"); box(18,29,3,1,"B");
  };
  const torso = (color: string, shadow = "B") => {
    shape([[11,15],[21,15],[24,18],[23,24],[9,24],[8,18]],"I");
    box(11,16,10,7,color); box(10,18,2,5,shadow); box(21,17,2,6,shadow);
    box(8,18,3,6,"I"); box(9,18,2,5,color);
    box(23,18,3,6,"I"); box(23,18,2,5,color);
    box(9,23,2,2,"T"); dot(9,23,"E"); box(23,23,2,2,"T"); dot(23,23,"E");
  };
  const hair = (color: string, highlight: string) => {
    shape([[10,3],[13,2],[20,2],[23,5],[22,8],[20,6],[17,6],[14,7],[11,6],[10,10],[9,6]],"I");
    shape([[11,3],[19,3],[22,5],[21,7],[19,5],[16,5],[13,6],[10,6]],color);
    line(12,3,17,3,highlight); dot(11,4,highlight); line(19,4,21,5,highlight);
  };
  legs();
  if (mode === "matrix") {
    head(id === "sage" || id === "rune" || id === "echo" ? "U" : "E", id === "sage" || id === "rune" || id === "echo" ? "V" : "T");
    if (id !== "sage") hair("H","J");
    if (id === "nova") {
      torso("B");
      shape([[10,16],[15,16],[15,27],[9,29],[8,27]],"B");
      shape([[17,16],[22,16],[25,28],[18,28]],"B");
      line(11,17,10,26,"G"); line(21,18,23,27,"G");
      box(15,16,3,10,"I"); dot(16,18,"G"); dot(16,21,"G"); dot(16,24,"G");
      shades(); box(11,5,9,2,"H"); dot(19,6,"J");
    } else if (id === "byte") {
      torso("B");
      box(12,16,8,2,"G"); box(13,17,7,1,"B");
      line(13,19,13,23,"G"); line(20,19,19,23,"G");
      box(14,24,5,1,"G"); dot(16,24,"K");
      box(21,3,3,4,"H"); box(22,3,1,2,"J");
      box(10,4,10,2,"H"); shades(); dot(15,12,"r");
      box(24,22,3,2,"I"); box(25,20,2,3,"B");
    } else if (id === "sage") {
      torso("H");
      shape([[10,16],[14,17],[15,27],[8,28]],"H");
      shape([[18,17],[22,16],[25,28],[17,27]],"H");
      line(10,18,12,24,"J"); line(21,18,20,25,"J");
      box(15,17,3,10,"B"); line(12,16,15,20,"G"); line(20,16,17,20,"G");
      shades(); box(13,12,7,1,"V"); dot(14,13,"H"); dot(19,13,"H"); dot(19,6,"U");
    } else if (id === "pip") {
      torso("S","G"); box(14,16,5,7,"K");
      shape([[10,16],[14,16],[16,20],[13,24],[10,23]],"S");
      shape([[19,16],[22,17],[22,24],[17,22],[17,20]],"S");
      line(11,17,14,20,"G"); line(21,17,18,20,"G");
      box(16,16,1,6,"I"); dot(17,23,"K");
      shades(); box(11,4,10,2,"H"); line(12,4,19,4,"J");
      box(25,10,1,4,"G"); dot(25,14,"C");
    } else if (id === "echo") {
      torso("o","H"); box(11,19,11,5,"A");
      line(12,18,12,23,"Q"); line(20,18,20,23,"Q"); box(14,16,5,2,"U");
      box(9,3,14,3,"W"); box(11,2,10,2,"K");
      box(10,5,3,2,"H"); box(21,5,2,3,"H"); eyes("H");
      line(12,11,14,11,"V"); line(19,11,21,11,"V");
      box(15,12,3,1,"H"); dot(15,13,"U");
      box(22,23,4,2,"Q"); dot(23,23,"K"); dot(25,24,"H");
    } else if (id === "rune") {
      torso("H"); box(13,16,7,7,"B");
      line(12,17,15,21,"J"); line(21,17,18,21,"J"); dot(16,23,"Q");
      for (const x of [8,10,22,24]) {
        box(x,4,1,13,"I"); box(x,5,1,2,"J"); dot(x,16,"Q");
      }
      box(10,3,12,3,"I"); line(12,3,20,3,"J"); eyes("H");
      dot(11,11,"Q"); dot(22,11,"Q"); box(15,12,3,1,"r");
    } else {
      torso("W","G"); box(13,16,7,7,"K"); box(16,17,1,6,"G");
      line(11,17,14,21,"G"); line(21,17,18,21,"G");
      box(12,24,3,5,"W"); box(18,24,3,5,"W");
      hair("W","K"); box(10,7,2,3,"W"); box(21,7,2,3,"W");
      shape([[11,11],[14,12],[18,12],[21,11],[20,14],[17,16],[14,15],[12,14]],"W");
      box(14,12,5,1,"T"); dot(16,14,"K"); eyes("G");
      line(11,7,14,7,"W"); line(18,7,21,7,"W");
    }
  } else {
    head(); eyes();
    if (id === "nova") {
      torso("F","B"); box(23,18,2,5,"E"); box(10,18,2,5,"E");
      shape([[9,14],[14,14],[15,18],[9,19],[7,17]],"I");
      shape([[9,15],[13,15],[14,17],[9,18],[8,17]],"G"); dot(10,15,"K"); dot(13,17,"K");
      box(13,23,8,2,"H"); dot(16,23,"Q"); box(12,20,1,3,"G");
      shape([[8,7],[8,3],[11,4],[12,0],[15,3],[17,0],[19,3],[23,2],[22,5],[25,5],[21,9],[18,6],[15,8],[13,5],[10,8]],"Q");
      line(12,2,14,4,"Y"); line(17,2,18,4,"Y"); line(20,4,22,3,"Y"); dot(11,5,"Y");
      // Buster Sword: broad steel blade, dark edge, rivets and wrapped handle.
      shape([[27,4],[30,4],[31,7],[29,23],[25,23]],"I");
      shape([[28,5],[30,6],[28,22],[26,22]],"G"); line(29,6,27,21,"K");
      dot(27,18,"I"); dot(27,20,"I"); box(24,23,7,1,"G"); box(26,24,2,6,"H"); dot(26,26,"Q");
    } else if (id === "byte") {
      torso("B"); box(10,15,13,3,"W");
      for (const x of [10,12,14,19,21,23]) dot(x,17,"K");
      box(15,18,4,5,"F"); dot(16,19,"Q"); dot(17,20,"G");
      line(12,23,20,23,"H"); dot(17,23,"G"); hair("H","J");
      shape([[11,4],[15,4],[14,9],[12,7],[11,10]],"H");
      line(15,7,17,10,"T"); dot(16,8,"r");
      box(27,13,2,13,"I"); box(27,14,1,10,"K"); box(26,23,4,2,"G");
      box(25,25,3,3,"I"); dot(26,26,"G"); box(28,24,2,1,"Q");
    } else if (id === "sage") {
      torso("N","G"); box(14,16,5,7,"W"); box(16,18,2,3,"K");
      line(12,17,13,23,"Q"); line(20,17,19,23,"Q");
      box(12,24,3,5,"N"); box(18,24,3,5,"N"); box(13,23,8,1,"H");
      hair("Q","Y"); box(9,6,2,10,"Q"); box(22,5,2,11,"Q");
      line(9,8,9,13,"Y"); line(23,8,23,13,"Y");
      shape([[14,4],[18,4],[20,6],[18,8],[16,5],[13,8]],"Q"); dot(16,4,"Y");
      line(22,24,26,28,"Q"); line(26,28,30,25,"Q"); dot(30,24,"Y");
      line(5,17,5,26,"G"); line(27,17,27,24,"G"); dot(5,17,"K");
    } else if (id === "pip") {
      torso("Q","H"); box(14,16,7,7,"I"); box(15,18,5,5,"E");
      box(9,18,3,4,"N"); box(23,18,2,5,"E"); line(10,18,10,21,"K");
      box(11,24,5,5,"N"); box(17,24,5,3,"I"); box(18,27,3,2,"E");
      box(13,23,8,1,"Q"); dot(16,17,"G"); dot(16,18,"Q");
      shape([[9,7],[8,4],[11,4],[12,1],[15,3],[17,0],[19,3],[22,2],[22,5],[24,5],[21,8],[18,6],[15,7],[12,6]],"Q");
      line(12,2,14,4,"Y"); line(17,2,18,4,"Y"); line(20,4,22,3,"Y");
      // Brotherhood: translucent water-blue blade with a hooked tip.
      shape([[27,12],[30,14],[29,25],[26,26],[26,15]],"C");
      line(28,14,28,24,"K"); dot(29,15,"N"); box(25,25,6,1,"Q"); box(27,26,1,4,"H");
    } else if (id === "echo") {
      torso("r","r"); box(10,17,2,6,"E"); box(23,17,2,6,"E");
      box(12,24,3,5,"W"); box(18,24,3,5,"W");
      box(13,16,7,1,"Q"); dot(16,17,"C"); box(12,23,9,1,"Q");
      hair("v","Z"); box(9,5,2,10,"v"); box(22,5,2,10,"v");
      shape([[22,2],[26,1],[28,4],[27,9],[25,11],[27,17],[25,18],[23,10]],"v");
      line(25,3,26,6,"Z"); line(25,11,26,15,"Z"); box(23,3,3,1,"r");
      box(9,17,2,5,"p"); box(23,17,2,5,"p"); dot(13,25,"Q"); dot(19,25,"Q");
      line(28,19,28,29,"G"); dot(28,19,"K"); box(27,25,3,1,"Q");
    } else if (id === "rune") {
      torso("W","G"); box(14,17,5,6,"B"); box(15,17,2,5,"H");
      line(11,18,13,22,"Q"); box(11,23,12,2,"H"); dot(16,23,"G");
      box(12,25,3,2,"E"); box(18,25,3,2,"E"); box(12,27,3,2,"B"); box(18,27,3,2,"B");
      shape([[22,16],[25,17],[26,29],[23,28],[22,24]],"r"); line(24,18,25,27,"R");
      hair("p","L"); shape([[9,4],[15,3],[15,6],[12,10],[12,17],[8,19],[9,9]],"p");
      line(10,6,10,15,"L"); shape([[17,3],[22,4],[23,7],[20,10],[20,6]],"p");
      box(26,16,2,12,"G"); line(27,16,27,24,"K"); box(25,25,5,1,"I");
    } else {
      torso("B","G"); box(14,16,5,7,"r"); line(14,17,18,21,"R");
      shape([[8,15],[12,14],[14,17],[10,19],[7,18]],"G");
      shape([[21,14],[25,15],[26,18],[22,19],[20,17]],"G");
      line(9,15,12,16,"K"); line(22,15,24,16,"K");
      line(11,20,12,23,"Q"); line(21,20,20,23,"Q"); box(13,23,8,1,"H"); dot(17,23,"Q");
      hair("H","J"); box(8,6,3,10,"H"); box(22,5,2,10,"H");
      shape([[12,4],[18,3],[21,5],[18,8],[16,5],[13,9]],"H"); dot(17,4,"J");
      dot(12,11,"H"); dot(20,11,"H"); line(14,13,18,13,"H"); dot(16,14,"H");
      shape([[28,5],[30,8],[29,23],[26,23]],"I"); line(29,7,27,22,"G"); dot(29,8,"K");
      box(25,23,6,1,"Q"); box(27,24,1,6,"H"); dot(27,29,"Q");
    }
  }
  return grid.map(row => row.join(""));
}

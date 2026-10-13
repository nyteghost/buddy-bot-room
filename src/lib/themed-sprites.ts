import type { AgentId } from "./agents";
export function themedSprite(id: AgentId, mode: "matrix" | "finalfantasy"): string[] {
  const g = Array.from({ length: 32 }, () => Array<string>(32).fill("."));
  const dot = (x: number, y: number, c: string) => { if (g[y] && x >= 0 && x < 32) g[y][x] = c; };
  const box = (x: number, y: number, w: number, h: number, c: string) => { for (let j = y; j < y+h; j++) for (let i=x; i<x+w; i++) dot(i,j,c); };
  const oval = (x: number, y: number, w: number, h: number, c: string) => { for(let j=0;j<h;j++) for(let i=0;i<w;i++) if(((i+.5-w/2)/(w/2))**2+((j+.5-h/2)/(h/2))**2<=1) dot(x+i,y+j,c); };
  box(11,23,5,7,"b"); box(17,23,5,7,"b"); box(10,29,6,2,"i"); box(17,29,6,2,"i");
  oval(7,14,19,12,"i"); box(9,15,15,10,"a"); box(8,16,3,8,"a"); box(23,16,3,8,"a");
  box(8,23,3,3,"e"); box(23,23,3,3,"e"); box(15,13,3,4,"e");
  oval(9,2,15,13,"e"); box(10,7,1,5,"t"); box(12,8,2,2,"i"); box(19,8,2,2,"i"); dot(16,10,"t"); box(14,13,5,1,"t");
  if(mode === "matrix") {
    const hair = id === "echo" || id === "rune" ? "i" : "h";
    if(id !== "sage") { oval(8,1,17,6,hair); box(9,5,2,4,hair); box(22,5,2,4,hair); }
    if(id === "nova" || id === "byte" || id === "sage" || id === "pip") {
      box(10,7,6,3,"i"); box(18,7,6,3,"i"); box(16,8,2,1,"g"); box(11,7,4,1,"c"); box(19,7,4,1,"c");
    }
    const coat = id === "pip" || id === "claude" ? "g" : id === "echo" ? "o" : "b";
    box(9,15,15,13,coat); box(8,16,3,8,coat); box(23,16,3,8,coat); box(16,16,1,11,"i");
    box(11,17,1,7,"g"); box(21,17,1,7,"g");
    if(id === "pip" || id === "claude") { box(14,15,5,4,"k"); box(16,16,1,5,"i"); }
    if(id === "byte") { box(21,1,4,4,"i"); box(13,17,7,1,"c"); }
    if(id === "echo") { box(9,0,15,2,"w"); box(12,17,8,7,"l"); box(10,23,4,2,"q"); }
    if(id === "rune") { for(const x of [8,10,22,24]) { box(x,3,1,11,"i"); dot(x,14,"q"); } }
    if(id === "claude") { box(11,10,12,4,"w"); box(14,11,5,2,"e"); box(11,7,5,3,"g"); box(18,7,5,3,"g"); box(12,8,3,1,"c"); box(19,8,3,1,"c"); }
    if(id === "nova") { box(8,24,4,4,"b"); box(22,24,4,4,"b"); }
  } else {
    const hair = id === "nova" || id === "sage" || id === "pip" ? "q" : id === "echo" ? "v" : id === "rune" ? "p" : "h";
    oval(8,0,17,7,hair); box(9,5,2,6,hair); box(22,5,2,6,hair); box(12,8,2,2,"c"); box(19,8,2,2,"c");
    box(14,16,5,2,"l"); box(10,24,14,1,"h"); dot(16,24,"q");
    if(id === "nova") {
      for(const [x,y] of [[10,0],[14,0],[18,1],[22,2]] as const) { box(x,y,3,4,"q"); dot(x+1,y-1,"q"); }
      box(8,14,6,4,"g"); dot(9,15,"k"); dot(12,16,"i"); box(23,17,3,6,"e");
      for(let y=7;y<29;y++) { box(27,y,3,1,"g"); dot(29,y,"k"); } box(25,24,7,1,"h"); box(28,25,1,5,"h");
    } else if(id === "byte") {
      box(8,15,17,3,"w"); box(9,18,5,7,"b"); box(20,18,5,7,"b"); box(15,17,3,8,"k");
      box(14,6,1,5,"t"); dot(15,7,"t"); box(26,16,2,13,"g"); box(25,23,5,2,"i"); box(28,22,2,2,"g");
    } else if(id === "sage") {
      box(8,7,2,9,"q"); box(23,7,2,9,"q"); box(14,17,5,6,"w"); box(13,17,1,7,"n"); box(19,17,1,7,"n");
      for(let j=0;j<7;j++) { dot(24+j,23+Math.floor(j/2),"q"); dot(24+j,24+Math.floor(j/2),"q"); } box(3,19,2,8,"g"); box(27,17,2,6,"g");
    } else if(id === "pip") {
      box(10,1,3,4,"q"); box(15,0,3,4,"q"); box(20,1,3,4,"q"); box(9,15,15,5,"q"); box(13,16,6,8,"i"); box(23,18,3,5,"e");
      box(11,25,5,4,"n"); box(17,25,5,4,"n"); box(26,15,2,13,"c"); dot(28,16,"k");
    } else if(id === "echo") {
      oval(22,0,6,9,"v"); box(24,8,3,8,"v"); box(11,17,11,7,"r"); box(8,17,3,7,"w"); box(23,17,3,7,"w"); box(11,25,5,4,"w"); box(17,25,5,4,"w");
      box(12,15,8,1,"q"); dot(16,16,"q"); box(27,16,1,12,"g");
    } else if(id === "rune") {
      box(8,6,3,12,"p"); box(9,15,15,9,"w"); box(16,17,2,7,"b"); box(23,17,3,12,"r"); box(21,18,2,9,"r"); box(10,24,14,2,"h");
      box(26,15,2,13,"g"); box(25,23,5,2,"i");
    } else {
      box(8,5,3,10,"h"); box(23,5,3,10,"h"); box(12,11,2,2,"t"); box(9,15,15,9,"b"); box(14,16,5,7,"r"); box(8,15,5,3,"g"); box(21,15,5,3,"g"); box(11,18,1,5,"k"); box(21,18,1,5,"k"); box(27,7,2,21,"g"); dot(28,8,"k"); box(25,23,6,1,"q");
    }
  }
  return g.map(row => row.join(""));
}
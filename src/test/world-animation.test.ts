import { describe,expect,it } from "vitest";
import {agents} from "@/lib/agents";
import {characterModes} from "@/lib/hellraiser";
import {characterSprite} from "@/lib/character-sprites";
import {WORLD_ACTIONS,WORLD_DIRECTIONS,WORLD_FRAMES_PER_ACTION,worldAnimatedFrame,worldSpriteAtlas} from "@/lib/world-animation";
describe("Character Universe complete frame atlas",()=>{
 it("covers each theme and Pal while sampling the full atlas in representative styles",()=>{
  // Full 9x10x8x9x4 atlas materialization is deliberately not done for every
  // test fixture: the real app generates the frame requested on demand.
  for(const mode of characterModes)for(const pal of agents){
   const base=characterSprite(pal.id,mode),before=JSON.stringify(base);
   for(const [i,dir] of WORLD_DIRECTIONS.entries()){
    const action=WORLD_ACTIONS[i]!;
    const result=worldAnimatedFrame(base,dir,action,i%4,pal.id==="mimic");
    expect(result).toHaveLength(32);
    expect(result.every(row=>row.length===32)).toBe(true);
    expect(result.some(row=>/[^.]/.test(row))).toBe(true);
   }
   expect(JSON.stringify(base)).toBe(before);
  }
  for(const mode of ["normal","cyberpunk"] as const)for(const pal of ["nova","mimic"] as const){
   const atlas=worldSpriteAtlas(characterSprite(pal,mode),pal==="mimic");
   expect(Object.keys(atlas)).toHaveLength(WORLD_DIRECTIONS.length*WORLD_ACTIONS.length*WORLD_FRAMES_PER_ACTION);
  }
 });
 it("expresses wave, celebration and walking as different native frames",()=>{
  const base=characterSprite("saiyan","cyberpunk");
  expect(worldAnimatedFrame(base,"s","wave",0)).not.toEqual(worldAnimatedFrame(base,"s","idle",0));
  expect(worldAnimatedFrame(base,"s","celebrate",0)).not.toEqual(worldAnimatedFrame(base,"s","rest",0));
  expect(worldAnimatedFrame(base,"se","walk",1)).not.toEqual(worldAnimatedFrame(base,"se","walk",3));
  expect(worldAnimatedFrame(base,"n","idle",0)).not.toEqual(worldAnimatedFrame(base,"s","idle",0));
 });
 it("keeps malformed animation input safe without mutating the source",()=>{
  const b=Array(32).fill(".".repeat(32)) as string[];
  expect(worldAnimatedFrame(b,"s","idle",NaN)).toEqual(b);
  expect(worldAnimatedFrame(["bad"],"s","idle",2)).toEqual(["bad"]);
 });
});

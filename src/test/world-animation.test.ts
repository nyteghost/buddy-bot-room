import { describe,expect,it } from "vitest";
import {agents} from "@/lib/agents";
import {characterModes} from "@/lib/hellraiser";
import {characterSprite} from "@/lib/character-sprites";
import {WORLD_ACTIONS,WORLD_DIRECTIONS,WORLD_FRAMES_PER_ACTION,worldAnimatedFrame,worldSpriteAtlas} from "@/lib/world-animation";
describe("Character Universe complete frame atlas",()=>{
 it("provides every compass heading, gesture and four-frame step for every Pal and theme",()=>{
  for(const mode of characterModes)for(const pal of agents){
   const base=characterSprite(pal.id,mode),serialized=JSON.stringify(base);
   const atlas=worldSpriteAtlas(base,pal.id==="mimic");
   expect(Object.keys(atlas)).toHaveLength(8*9*WORLD_FRAMES_PER_ACTION);
   for(const dir of WORLD_DIRECTIONS)for(const action of WORLD_ACTIONS)for(let phase=0;phase<4;phase++){
    const result=atlas[dir+":"+action+":"+phase]!;
    expect(result).toHaveLength(32);
    expect(result.every(row=>row.length===32)).toBe(true);
    expect(result.some(row=>/[^.]/.test(row))).toBe(true);
    expect(JSON.stringify(base)).toBe(serialized);
   }
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

import {describe,expect,it} from "vitest";
import {characterSprite} from "@/lib/character-sprites";
import {agents} from "@/lib/agents";
import {characterModes} from "@/lib/hellraiser";
import {worldFacingSprite} from "@/lib/world-facing-sprites";
import {livingWorldFromValue} from "@/lib/living-world";
const headings=["n","ne","e","se","s","sw","w","nw"] as const;
describe("Living World",()=>{
 it("defaults on with explicit Classic opt-out",()=>{
  expect(livingWorldFromValue(null)).toBe(true);
  expect(livingWorldFromValue("classic")).toBe(false);
 });
 it("renders 8 native views across existing themes and all Pals",()=>{
  for(const mode of characterModes)for(const pal of agents){
   const original=characterSprite(pal.id,mode);
   const views=headings.map(h=>worldFacingSprite(original,h,0,pal.id==="mimic"));
   for(const grid of views){
    expect(grid).toHaveLength(32);
    expect(grid.every(r=>r.length===32)).toBe(true);
    expect(grid.some(r=>/[^.]/.test(r))).toBe(true);
   }
   expect(new Set(views.map(g=>g.join("|"))).size).toBeGreaterThan(1);
   expect(views[4]).toEqual(original);
  }
 });
 it("alternates step phases without changing source models",()=>{
  const original=characterSprite("byte","cyberpunk"),before=JSON.stringify(original);
  expect(worldFacingSprite(original,"e",1)).not.toEqual(worldFacingSprite(original,"e",3));
  expect(JSON.stringify(original)).toBe(before);
 });
});

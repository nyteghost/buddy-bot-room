import {describe,expect,it} from "vitest";
import {guestIds,guestName,guestPalette,guestSprite,guestPose,guestRoute} from "@/lib/world-guest-packs";
import {characterModes} from "@/lib/hellraiser";
import {worldPointIsWalkable} from "@/lib/world-navigation";
import {worldAnimatedFrame} from "@/lib/world-animation";
describe("Character Universe visual visitor roster",()=>{
 it("provides eight distinctive original and fan tribute models",()=>{
  expect(guestIds.length).toBe(8);
  const silhouettes=new Set<string>();
  for(const id of guestIds){
   expect(guestName(id).length).toBeGreaterThan(2);
   const g=guestSprite(id);
   expect(g).toHaveLength(32);expect(g.every(row=>row.length===32)).toBe(true);
   const codes=new Set(g.join("").replace(/\./g,""));
   for(const code of codes)expect(guestPalette[code]).toBeTruthy();
   silhouettes.add(g.join("\n"));
   expect(worldAnimatedFrame(g,"nw","walk",2).every(row=>row.length===32)).toBe(true);
  }
  expect(silhouettes.size).toBe(guestIds.length);
 });
 it("walks around every room obstacle and stays on the floor",()=>{
  for(const mode of characterModes)for(const id of guestIds){
   const path=guestRoute(id,mode);
   expect(path.length).toBeGreaterThan(1);
   for(const p of path)expect(worldPointIsWalkable(p,mode)).toBe(true);
   for(let ms=0;ms<39000;ms+=300){
    const p=guestPose(id,mode,ms);
    expect(worldPointIsWalkable(p,mode)).toBe(true);
   }
  }
 });
 it("keeps each visitor a local visual actor with no network dependency",()=>{
  for(const id of guestIds){
   expect(guestPose(id,"normal",0).action).toBeTruthy();
   expect(guestPose(id,"normal",39000)).toEqual(guestPose(id,"normal",0));
  }
 });
});

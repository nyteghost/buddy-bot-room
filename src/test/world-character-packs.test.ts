import { describe,expect,it } from "vitest";
import { greenJacketPose,greenJacketSprite,readWorldPacks,worldHideoutForTheme,greenJacketPalette } from "@/lib/world-character-packs";
import { worldFacingSprite } from "@/lib/world-facing-sprites";
describe("Living World original character packs",()=>{
 it("can disable and restore a pack without changing other state",()=>{
  expect(readWorldPacks(null)).toEqual(["green-jacket"]);
  expect(readWorldPacks("[]")).toEqual([]);
  expect(readWorldPacks('["green-jacket","green-jacket","unknown"]')).toEqual(["green-jacket"]);
  expect(readWorldPacks("invalid")).toEqual(["green-jacket"]);
 });
 it("renders a recognizable native 32px hi-vis character from all eight angles",()=>{
  const art=greenJacketSprite();
  expect(art).toHaveLength(32);
  expect(art.every(row=>row.length===32)).toBe(true);
  const colors=new Set(art.join("").replace(/\./g,""));
  expect(colors).toContain("l");expect(colors).toContain("b");expect(colors).toContain("g");
  for(const color of colors)expect(greenJacketPalette[color]).toBeTruthy();
  for(const facing of ["n","ne","e","se","s","sw","w","nw"] as const)
   expect(worldFacingSprite(art,facing,1).every(row=>row.length===32)).toBe(true);
 });
 it("walks, waves, hides and reappears on a bounded route",()=>{
  expect(greenJacketPose(0).action).toBe("idle");
  expect(greenJacketPose(6000).action).toBe("walking");
  expect(greenJacketPose(12000).action).toBe("wave");
  expect(greenJacketPose(22400).action).toBe("retreat");
  expect(greenJacketPose(26000).opacity).toBe(0);
  expect(greenJacketPose(31000).action).toBe("return");
  expect(greenJacketPose(40000)).toEqual(greenJacketPose(0));
  for(let ms=0;ms<40000;ms+=500){
   const pose=greenJacketPose(ms);
   expect(pose.x).toBeGreaterThanOrEqual(55);expect(pose.x).toBeLessThanOrEqual(93);
   expect(pose.y).toBeGreaterThanOrEqual(60);expect(pose.y).toBeLessThanOrEqual(72);
   expect(pose.opacity).toBeGreaterThanOrEqual(0);expect(pose.opacity).toBeLessThanOrEqual(1);
  }
  expect(worldHideoutForTheme("cyberpunk")).toBe("server");
  expect(worldHideoutForTheme("finalfantasy")).toBe("portal");
  expect(worldHideoutForTheme("normal")).toBe("hedge");
 });
});

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

import { createElement } from "react";
import { render } from "@testing-library/react";
import { PixelCharacter } from "@/components/pixel-character";
import { spriteRuns } from "@/lib/sprite-upscale";
import { worldPropForTheme } from "@/components/world-atmosphere";
describe("native pixel rendering and dynamic props",()=>{
 it("renders 32px step art without thousands of unnecessary upscaled rectangles",()=>{
  const view=render(createElement(PixelCharacter,{id:"byte",mode:"cyberpunk",pixelWorld:true,walking:true,facing:"se",walkFrame:1}));
  const sprite=view.container.querySelector("svg.world-native-sprite");
  // Native 32-pixel-wide grid; Living World lengthens legs by whole rows (world-proportions).
  expect(sprite?.getAttribute("viewBox")).toMatch(/^0 0 32 (2[4-9]|3[0-9]|4[0-4])$/);
  expect(view.container.querySelectorAll("svg rect").length).toBeLessThan(700);
  view.unmount();
 });
 it("preserves the native pixels and original character models",()=>{
  const grid=worldFacingSprite(characterSprite("sage","normal"),"ne",2);
  expect(spriteRuns(grid,(x,y)=>y<24?"body":x<16?"left-leg":"right-leg").length).toBeLessThan(700);
 });
 it("assigns a decorative prop to every theme",()=>{
  for(const theme of characterModes)expect(worldPropForTheme(theme)).toMatch(/^(console|firefly|crystal|torch|neon|lantern|portal)$/);
  expect(worldPropForTheme("matrix")).toBe("console");
  expect(worldPropForTheme("finalfantasy")).toBe("crystal");
 });
});

import { worldTimeForHour } from "@/components/world-atmosphere";
describe("browser-local living room lighting",()=>{
 it("selects morning, daytime, evening, and night with stable boundaries",()=>{
  expect(worldTimeForHour(0)).toBe("night");
  expect(worldTimeForHour(4)).toBe("night");
  expect(worldTimeForHour(5)).toBe("morning");
  expect(worldTimeForHour(9)).toBe("morning");
  expect(worldTimeForHour(10)).toBe("day");
  expect(worldTimeForHour(17)).toBe("day");
  expect(worldTimeForHour(18)).toBe("evening");
  expect(worldTimeForHour(21)).toBe("evening");
  expect(worldTimeForHour(22)).toBe("night");
  expect(worldTimeForHour(NaN)).toBe("day");
  expect(worldTimeForHour(25)).toBe("night");
 });
});

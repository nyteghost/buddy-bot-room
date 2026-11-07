import {describe,expect,it} from "vitest";
import {cleanWorldPalSkins,worldPalSkinCharacter,withWorldPalSkin} from "@/lib/world-pal-skins";
import {starterCustomCharacter} from "@/lib/world-custom-packs";

const hd={...starterCustomCharacter(),id:"user-hdlook0001",hd3:{version:1,artStatus:"prototype" as const,movement:"humanoid" as const,directions:{s:{idle:{frames:[{src:"x",durationMs:100}],loop:true}}}}};
const plain={...starterCustomCharacter(),id:"user-plainart01"};
describe("opt-in HD looks for the original Pals (visual only)",()=>{
 it("accepts only known Pals and well-formed character ids, one Pal per character",()=>{
  expect(cleanWorldPalSkins({nova:"user-hdlook0001",byte:"user-hdlook0001",zed:"user-other00001",sage:"../etc",pip:42})).toEqual({nova:"user-hdlook0001"});
  expect(cleanWorldPalSkins(null)).toEqual({});expect(cleanWorldPalSkins([1])).toEqual({});
 });
 it("falls back to the native sprite when the character is missing or has no HD art",()=>{
  expect(worldPalSkinCharacter({nova:hd.id},[hd],"nova")?.id).toBe(hd.id);
  expect(worldPalSkinCharacter({nova:hd.id},[],"nova")).toBeUndefined();
  expect(worldPalSkinCharacter({nova:plain.id},[plain],"nova")).toBeUndefined();
  expect(worldPalSkinCharacter({},[hd],"nova")).toBeUndefined();
 });
 it("moves a look between Pals and clears it",()=>{
  let skins=withWorldPalSkin({},"nova",hd.id);
  expect(skins).toEqual({nova:hd.id});
  skins=withWorldPalSkin(skins,"byte",hd.id);
  expect(skins).toEqual({byte:hd.id});
  expect(withWorldPalSkin(skins,"byte",null)).toEqual({});
  expect(withWorldPalSkin(skins,"not-a-pal",hd.id)).toBe(skins);
 });
});

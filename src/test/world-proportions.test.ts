import {describe,expect,it} from "vitest";
import {characterModes} from "@/lib/hellraiser";
import {characterSprite} from "@/lib/character-sprites";
import {worldAnimatedFrame} from "@/lib/world-animation";
import {guestIds,guestSprite} from "@/lib/world-guest-packs";
import {WORLD_LEG_EXTENSION,worldGuestBody,worldLegRow,worldLegStart,worldPalBody,worldTallSprite} from "@/lib/world-proportions";

const pals=["nova","byte","sage","pip","echo","rune","claude","saiyan","mimic"] as const;
const opaque=(grid:readonly string[])=>grid.join("").replace(/\./g,"").length;
describe("Living World adult proportions for native sprites",()=>{
 it("lengthens humanoid legs with whole rows and keeps every pixel square and every row 32 wide",()=>{
  for(const mode of characterModes)for(const id of pals){
   const front=characterSprite(id,mode),legRow=worldLegRow("test:"+mode+":"+id,()=>front);
   const extra=WORLD_LEG_EXTENSION[worldPalBody(id)];
   for(const facing of ["s","e","n","sw"] as const)for(let frame=0;frame<4;frame++){
    const source=worldAnimatedFrame(front,facing,"walk",frame,id==="mimic");
    const tall=worldTallSprite(source,extra,legRow);
    expect(tall.every(row=>row.length===32)).toBe(true);
    expect(tall.length).toBe(id==="mimic"?32:32+extra);
    // Everything above the legs (head, face, outfit) is untouched.
    if(legRow<0){expect(tall).toEqual(source);continue;}
    expect(tall.slice(0,legRow)).toEqual(source.slice(0,legRow));
    // ...and the feet below the repeated leg row are the same rows, just lower.
    const below=source.length-legRow-1;
    expect(tall.slice(tall.length-below)).toEqual(source.slice(source.length-below));
   }
  }
 });
 it("finds legs on every humanoid Pal in every theme, and none on the mimic chest",()=>{
  for(const mode of characterModes)for(const id of pals){
   const row=worldLegStart(characterSprite(id,mode));
   if(id==="mimic")expect(row).toBe(-1);
   else{expect(row).toBeGreaterThanOrEqual(20);expect(row).toBeLessThanOrEqual(30);}
  }
 });
 it("makes figures taller relative to their width",()=>{
  const front=characterSprite("byte","normal"),tall=worldTallSprite(front,WORLD_LEG_EXTENSION.humanoid);
  const height=(g:readonly string[])=>g.filter(row=>row.replace(/\./g,"")).length;
  expect(height(tall)/height(front)).toBeGreaterThan(1.15);
  expect(opaque(tall)).toBeGreaterThan(opaque(front));
 });
 it("keeps mascots, floaters and objects in shape by body type",()=>{
  expect(worldGuestBody("arcade-ghost")).toBe("floating");
  expect(worldTallSprite(guestSprite("arcade-ghost"),WORLD_LEG_EXTENSION.floating)).toEqual(guestSprite("arcade-ghost"));
  expect(WORLD_LEG_EXTENSION[worldGuestBody("tiny-dragon")]).toBeLessThan(WORLD_LEG_EXTENSION.humanoid);
  for(const id of guestIds)if(worldGuestBody(id)!=="floating")expect(worldLegStart(guestSprite(id))).toBeGreaterThan(20);
 });
 it("ignores bad input and caps the extension",()=>{
  const front=characterSprite("sage","normal");
  expect(worldTallSprite(front,Number.NaN)).toEqual(front);
  expect(worldTallSprite(front,99).length).toBe(44);
  expect(worldTallSprite(front,4,500)).toEqual(front);
 });
});

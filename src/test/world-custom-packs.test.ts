import {describe,expect,it} from "vitest";
import {CUSTOM_WORLD_LIMIT,MAX_ACTIVE_VISITORS,starterCustomCharacter,validateCustomCharacter,cleanCustomCharacters,readCustomCharacters,importCustomCharacters,exportCustomCharacters,cleanEnabledWorldIds} from "@/lib/world-custom-packs";
describe("Character Universe custom pack security",()=>{
 it("creates a valid original 32px template and round-trips a JSON file",()=>{
  const c=starterCustomCharacter();
  expect(validateCustomCharacter(c)).not.toBeNull();
  expect(c.pixels).toHaveLength(32);
  expect(c.pixels.every(row=>row.length===32)).toBe(true);
  expect(importCustomCharacters(exportCustomCharacters([c]))).toEqual([c]);
  expect(readCustomCharacters(JSON.stringify([c]))).toEqual([c]);
 });
 it("rejects script, SVG, URL, palette injection and oversized artwork",()=>{
  const c=starterCustomCharacter();
  expect(validateCustomCharacter({...c,name:"<script>alert(1)</script>"})).toBeNull();
  expect(validateCustomCharacter({...c,palette:{a:"url(javascript:evil)"}})).toBeNull();
  expect(validateCustomCharacter({...c,pixels:[...c.pixels.slice(0,31),"<svg/onload=alert(1)>"]})).toBeNull();
  expect(validateCustomCharacter({...c,pixels:Array(32).fill("a".repeat(31)+"Z")})).toBeNull();
  expect(validateCustomCharacter({...c,id:"../../data/memory"})).toBeNull();
  expect(importCustomCharacters(JSON.stringify({format:"other",version:1,characters:[c]}))).toBeNull();
  expect(importCustomCharacters("a".repeat(120001))).toBeNull();
 });
 it("caps local assets and guest selections without touching AI Pal identities",()=>{
  const c=starterCustomCharacter();
  expect(cleanCustomCharacters(Array(CUSTOM_WORLD_LIMIT+1).fill(c))).toEqual([]);
  expect(cleanCustomCharacters([{...c,id:c.id},{...c,id:c.id}])).toEqual([]);
  const allowed=["green-jacket","goku","homer","space-ranger","robot","dragon","ghost","mage"];
  expect(cleanEnabledWorldIds([...allowed,"not-a-real-guest"],allowed).length).toBe(MAX_ACTIVE_VISITORS);
  expect(cleanEnabledWorldIds(["green-jacket","green-jacket"],allowed)).toEqual(["green-jacket"]);
 });
});

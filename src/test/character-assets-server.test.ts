import { afterEach,beforeEach,describe,expect,it } from "vitest";
import { mkdtemp,readFile,readdir,rm,writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { characterAssetResponse,hydrateCharacterAssets,persistCharacterAssets,validateDecodedCharacterPng } from "@/lib/character-assets.server";
import { hdCharacter,hdPng } from "./character-hd-fixture";

let root="";
beforeEach(async()=>{root=await mkdtemp(join(tmpdir(),"hd-assets-"));});
afterEach(async()=>{await rm(root,{recursive:true,force:true});});
describe("HD character immutable storage",()=>{
 it("decodes pixels and rejects opaque, empty, truncated or oversized decoded artwork",()=>{
  expect(()=>validateDecodedCharacterPng(hdPng())).not.toThrow();
  for(const png of [hdPng({opaque:true}),hdPng({empty:true}),hdPng({scanlines:Buffer.alloc(12)}),hdPng({scanlines:Buffer.alloc(256*1025+1)}),hdPng({scanlines:Buffer.alloc(256*1025,5)})])
   expect(()=>validateDecodedCharacterPng(png)).toThrow();
 });
 it("stores one immutable PNG, hydrates exact bytes, and rejects corrupted references",async()=>{
  const original=hdCharacter();
  original.hd3!.directions.s!.walk=structuredClone(original.hd3!.directions.s!.idle!);
  const saved=await persistCharacterAssets(root,[original]);
  const source=saved[0]!.hd3!.directions.s!.idle!.frames[0]!.src;
  expect(source).toMatch(/^\/api\/character-universe\?asset=[a-f0-9]{64}$/);
  expect(original.hd3!.directions.s!.idle!.frames[0]!.src).toMatch(/^data:/);
  expect(await readdir(join(root,"character-assets"))).toHaveLength(1);
  expect(await hydrateCharacterAssets(root,saved)).toEqual([original]);
  const hash=source.split("=")[1]!;
  expect(Buffer.from(await (await characterAssetResponse(root,hash)).arrayBuffer())).toEqual(hdPng());
  await persistCharacterAssets(root,[original]);
  expect(await readdir(join(root,"character-assets"))).toHaveLength(1);
  await writeFile(join(root,"character-assets",hash+".png"),"corrupt");
  await expect(persistCharacterAssets(root,saved)).rejects.toThrow(/integrity/);
  expect((await characterAssetResponse(root,hash)).status).toBe(404);
  expect(await readFile(join(root,"character-assets",hash+".png"),"utf8")).toBe("corrupt");
 });
 it("rejects unsafe refs and incomplete images before writing artwork",async()=>{
  const c=hdCharacter();c.hd3!.directions.s!.idle!.frames[0]!.src="https://example.com/private.png";
  await expect(persistCharacterAssets(root,[c])).rejects.toThrow();
  expect((await characterAssetResponse(root,"../secret")).status).toBe(400);
  expect(await readdir(root)).toEqual([]);
 });
});

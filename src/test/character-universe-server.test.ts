import { afterEach,beforeEach,describe,expect,it,vi } from "vitest";
import {mkdtemp,readFile,rm,stat,readdir,writeFile} from "node:fs/promises";
import {tmpdir} from "node:os";
import {join} from "node:path";
import {currentUser} from "@/lib/accounts.server";
import {handleCharacterUniverse,CHARACTER_REQUEST_LIMIT} from "@/lib/character-universe.server";
import {hdCharacter} from "./character-hd-fixture";
import {starterCustomCharacter} from "@/lib/world-custom-packs";

vi.mock("@/lib/accounts.server",()=>({currentUser:vi.fn()}));
let root="";
const url="http://localhost/api/character-universe";
const get=()=>handleCharacterUniverse(new Request(url));
const post=(body:unknown,headers?:Record<string,string>)=>handleCharacterUniverse(new Request(url,{
 method:"POST",headers:{"content-type":"application/json",...headers},body:JSON.stringify(body)
}));
beforeEach(async()=>{
 root=await mkdtemp(join(tmpdir(),"pixel-character-universe-"));
 vi.stubEnv("BUDDY_DATA_DIR",root);
 vi.mocked(currentUser).mockReset().mockResolvedValue({username:"owner",owner:true});
});
afterEach(async()=>{vi.unstubAllEnvs();await rm(root,{recursive:true,force:true});});
describe("Unraid-backed Character Universe privacy and revisions",()=>{
 it("rejects non-owners and cross-origin writes",async()=>{
  vi.mocked(currentUser).mockResolvedValueOnce(null);
  expect((await get()).status).toBe(403);
  expect((await post({op:"setEnabled",expectedRevision:0,ids:["goku"]},{"origin":"https://evil.example"})).status).toBe(403);
  expect((await get()).status).toBe(200);
 });
 it("saves owner-created sprite packs as private revision-checked data",async()=>{
  const first=await (await get()).json() as {revision:number;characters:unknown[]};
  expect(first.revision).toBe(0);expect(first.characters).toHaveLength(0);
  const character=starterCustomCharacter();
  const saved=await post({op:"save",expectedRevision:0,character});
  expect(saved.status).toBe(200);
  const value=await saved.json() as {revision:number;characters:typeof character[]};
  expect(value.revision).toBe(1);expect(value.characters[0]?.name).toBe("My Pixel Pal");
  const disk=JSON.parse(await readFile(join(root,"character-universe.json"),"utf8")) as {revision:number};
  expect(disk.revision).toBe(1);
  expect((await stat(join(root,"character-universe.json"))).mode&0o777).toBe(0o600);
  expect((await post({op:"save",expectedRevision:0,character:{...character,name:"Stale edit"}})).status).toBe(409);
  expect((await post({op:"setEnabled",expectedRevision:1,ids:["green-jacket",character.id,"goku"]})).status).toBe(200);
  const read=await (await get()).json() as {revision:number;enabled:string[]};
  expect(read.enabled).toContain(character.id);
  const deleted=await post({op:"delete",expectedRevision:2,id:character.id});
  expect(deleted.status).toBe(200);
  const final=await (await get()).json() as {characters:unknown[];enabled:string[]};
  expect(final.characters).toEqual([]);expect(final.enabled).not.toContain(character.id);
 });
 it("installs ZIP selections atomically and never replaces existing art",async()=>{
  const first=starterCustomCharacter(),second=starterCustomCharacter(),third=starterCustomCharacter();
  const accepted=await post({op:"installPack",expectedRevision:0,characters:[first,second]});
  expect(accepted.status).toBe(200);
  const installed=await (await get()).json() as {revision:number;characters:{id:string}[]};
  expect(installed.revision).toBe(1);
  expect(installed.characters.map(c=>c.id)).toEqual([first.id,second.id]);
  const duplicate=await post({op:"installPack",expectedRevision:1,characters:[first,third]});
  expect(duplicate.status).toBe(409);
  const after=await (await get()).json() as {revision:number;characters:{id:string}[]};
  expect(after.revision).toBe(1);
  expect(after.characters.map(c=>c.id)).toEqual([first.id,second.id]);
 });
 it("rejects executable artwork, foreign paths, huge requests and unauthorized guest IDs",async()=>{
  const c=starterCustomCharacter();
  expect((await post({op:"save",expectedRevision:0,character:{...c,name:"<script>bad</script>"}})).status).toBe(400);
  expect((await post({op:"save",expectedRevision:0,character:{...c,id:"../../../secret"}})).status).toBe(400);
  expect((await post({op:"setEnabled",expectedRevision:0,ids:["homer","bogus"]})).status).toBe(400);
  expect((await post({op:"setEnabled",expectedRevision:0,ids:["green-jacket","goku","homer","space-ranger","pixel-robot","arcade-ghost","moon-mage"]})).status).toBe(400);
  const tooBig=await handleCharacterUniverse(new Request(url,{
   method:"POST",headers:{"content-type":"application/json","content-length":String(CHARACTER_REQUEST_LIMIT+1)},body:"x"
  }));
  expect(tooBig.status).toBe(413);
 });
});

describe("HD directional library revisions and recovery",()=>{
 it("authorizes asset and export requests before reading files",async()=>{
  vi.mocked(currentUser).mockResolvedValue(null);
  for(const suffix of ["?export=1","?asset="+"a".repeat(64)])expect((await handleCharacterUniverse(new Request(url+suffix))).status).toBe(403);
 });
 it("retains original art during updates, rejects stale versions, and exports portable artwork",async()=>{
  const character=hdCharacter();
  const saved=await post({op:"installPack",expectedRevision:0,characters:[character]});
  expect(saved.status).toBe(200);
  const stored=await saved.json();
  expect(stored.characters[0].hd3.directions.s.idle.frames[0].src).toMatch(/^\/api\//);
  expect(stored.enabled).not.toContain(character.id);
  const changed=structuredClone(character);changed.hd3!.version=2;changed.name="Updated visitor";
  expect((await post({op:"updatePack",expectedRevision:1,expectedVersions:{[character.id]:0},characters:[changed]})).status).toBe(409);
  expect((await post({op:"updatePack",expectedRevision:1,expectedVersions:{[character.id]:1},characters:[changed]})).status).toBe(200);
  expect((await post({op:"installPack",expectedRevision:2,characters:[character]})).status).toBe(409);
  expect((await post({op:"save",expectedRevision:2,character})).status).toBe(400);
  const histories=await readdir(join(root,"character-history"));
  const prior=JSON.parse(await readFile(join(root,"character-history",histories.find(n=>n.startsWith("1-"))!),"utf8"));
  expect(prior.characters[0].name).toBe(character.name);
  expect(prior.characters[0].hd3.version).toBe(1);
  const exported=await (await handleCharacterUniverse(new Request(url+"?export=1"))).json();
  expect(exported.characters).toEqual([changed]);
  expect(await readdir(join(root,"character-assets"))).toHaveLength(1);
 });
 it("upgrades reviewed legacy HD artwork with version zero and preserves its original history",async()=>{
  const updated=hdCharacter();const legacy=structuredClone(updated);
  legacy.hd={resolution:256,idle:[updated.hd3!.directions.s!.idle!.frames[0]!.src]};delete legacy.hd3;
  expect((await post({op:"installPack",expectedRevision:0,characters:[legacy]})).status).toBe(200);
  expect((await post({op:"updatePack",expectedRevision:1,expectedVersions:{[legacy.id]:0},characters:[updated]})).status).toBe(200);
  const histories=await readdir(join(root,"character-history"));
  const original=JSON.parse(await readFile(join(root,"character-history",histories.find(n=>n.startsWith("1-"))!),"utf8"));
  expect(original.characters).toEqual([legacy]);
 });
 it("keeps the exact corrupt store instead of resetting it",async()=>{
  for(const text of ['{broken',JSON.stringify({revision:-1,characters:[],enabled:[]})]){
   await writeFile(join(root,"character-universe.json"),text);
   expect((await get()).status).toBe(500);
   expect((await post({op:"save",expectedRevision:0,character:starterCustomCharacter()})).status).toBe(500);
   expect(await readFile(join(root,"character-universe.json"),"utf8")).toBe(text);
  }
 });
 it("allows a reviewed 23-character backup without enabling guests",async()=>{
  const characters=Array.from({length:23},()=>starterCustomCharacter());
  expect((await post({op:"installBackup",expectedRevision:0,characters})).status).toBe(200);
  const saved=await (await get()).json();expect(saved.characters).toHaveLength(23);expect(saved.enabled).toEqual(["green-jacket"]);
 });
});

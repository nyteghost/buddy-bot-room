import { afterEach,beforeEach,describe,expect,it,vi } from "vitest";
import {mkdtemp,readFile,rm,stat} from "node:fs/promises";
import {tmpdir} from "node:os";
import {join} from "node:path";
import {currentUser} from "@/lib/accounts.server";
import {handleCharacterUniverse} from "@/lib/character-universe.server";
import {starterCustomCharacter,CUSTOM_WORLD_FILE_LIMIT} from "@/lib/world-custom-packs";

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
 it("rejects executable artwork, foreign paths, huge requests and unauthorized guest IDs",async()=>{
  const c=starterCustomCharacter();
  expect((await post({op:"save",expectedRevision:0,character:{...c,name:"<script>bad</script>"}})).status).toBe(400);
  expect((await post({op:"save",expectedRevision:0,character:{...c,id:"../../../secret"}})).status).toBe(400);
  expect((await post({op:"setEnabled",expectedRevision:0,ids:["homer","bogus"]})).status).toBe(400);
  expect((await post({op:"setEnabled",expectedRevision:0,ids:["green-jacket","goku","homer","space-ranger","pixel-robot","arcade-ghost","moon-mage"]})).status).toBe(400);
  const tooBig=await handleCharacterUniverse(new Request(url,{
   method:"POST",headers:{"content-type":"application/json"},body:"x".repeat(CUSTOM_WORLD_FILE_LIMIT+1)
  }));
  expect(tooBig.status).toBe(413);
 });
});

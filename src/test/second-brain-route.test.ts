import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { mkdtemp, mkdir, readFile, rm, readdir } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { handleSecondBrain } from "@/lib/second-brain.server";
let vault="";
beforeEach(async()=>{
 vault=await mkdtemp(join(tmpdir(),"pixelpals-secondbrain-"));
 vi.stubEnv("OBSIDIAN_VAULT_DIR",vault);
 vi.stubEnv("BUDDY_ACCOUNTS","0");
});
afterEach(async()=>{
 vi.unstubAllEnvs();
 await rm(vault,{recursive:true,force:true});
});
const call=(body:unknown)=>new Request("http://localhost/api/second-brain",{method:"POST",headers:{"content-type":"application/json"},body:JSON.stringify(body)});
describe("owner-controlled Second Brain notebook",()=>{
 it("creates, reads, searches, detects edit conflicts and soft-trashes an approved note", async()=>{
  const now="2026-10-31T12:00:00.000Z";
  const note={id:"test-memory",category:"Preferences",title:"Short directions",body:"I prefer small steps.",createdAt:now,updatedAt:now,source:"user-confirmed",tags:[]};
  const created=await handleSecondBrain(call({op:"save",note}));
  expect(created.status).toBe(200);
  const saved=(await created.json() as {note:typeof note}).note;
  const found=await handleSecondBrain(new Request("http://localhost/api/second-brain?q=steps"));
  expect((await found.json() as {notes:typeof note[]}).notes[0]?.body).toBe("I prefer small steps.");
  expect((await handleSecondBrain(call({op:"save",note:{...note,body:"Edited"},revision:"stale"}))).status).toBe(409);
  expect((await handleSecondBrain(call({op:"trash",id:note.id,revision:(saved as typeof saved & {revision:string}).revision}))).status).toBe(200);
  const after=await handleSecondBrain(new Request("http://localhost/api/second-brain"));
  expect((await after.json() as {notes:unknown[]}).notes).toEqual([]);
  expect((await readdir(join(vault,".trash"))).some(x=>x.startsWith(note.id))).toBe(true);
 });
 it("never accepts arbitrary categories or filenames", async()=>{
  const bad={id:"../escape",category:"Preferences",title:"Break out",body:"bad",createdAt:"x",updatedAt:"x",source:"explicit-save",tags:[]};
  expect((await handleSecondBrain(call({op:"save",note:bad}))).status).toBe(400);
  expect((await readdir(vault))).toEqual([]);
 });
});

it("detects an external Obsidian edit even when its timestamp is unchanged", async()=>{
 const note={id:"external-edit",category:"Preferences",title:"Directions",body:"Small steps",createdAt:"2026-10-31T12:00:00Z",updatedAt:"2026-10-31T12:00:00Z",source:"user-confirmed",tags:[]};
 const saved=(await (await handleSecondBrain(call({op:"save",note}))).json()).note;
 const file=join(vault,"PixelPals/Preferences/Directions--external-edit.md");
 const {writeFile}=await import("node:fs/promises");
 await writeFile(file,(await readFile(file,"utf8")).replace("Small steps","Edited in Obsidian"));
 expect((await handleSecondBrain(call({op:"save",note:{...saved,body:"Stale browser draft"},revision:saved.revision}))).status).toBe(409);
 expect(await readFile(file,"utf8")).toContain("Edited in Obsidian");
});

it("edits titles and externally renamed notes without duplicating or losing the note", async()=>{
 const note={id:"rename",category:"Projects",title:"Before",body:"Project context",createdAt:"2026-10-31T12:00:00Z",updatedAt:"2026-10-31T12:00:00Z",source:"explicit-save",tags:[]};
 const saved=(await (await handleSecondBrain(call({op:"save",note}))).json()).note;
 const {rename}=await import("node:fs/promises");
 await rename(join(vault,"PixelPals/Projects/Before--rename.md"),join(vault,"PixelPals/Projects/External--rename.md"));
 const result=await handleSecondBrain(call({op:"save",note:{...saved,title:"After"},revision:saved.revision}));
 expect(result.status).toBe(200);
 expect(await readdir(join(vault,"PixelPals/Projects"))).toEqual(["External--rename.md"]);
 expect(await readFile(join(vault,"PixelPals/Projects/External--rename.md"),"utf8")).toContain("# After");
});

it("rejects a symlinked PixelPals directory before creating children in ShowPilot", async()=>{
 const {symlink}=await import("node:fs/promises");
 await mkdir(join(vault,"ShowPilot"));
 await symlink(join(vault,"ShowPilot"),join(vault,"PixelPals"));
 const note={id:"escape",category:"Preferences",title:"Bad",body:"Do not save",createdAt:"2026-10-31T12:00:00Z",updatedAt:"2026-10-31T12:00:00Z",source:"explicit-save",tags:[]};
 expect((await handleSecondBrain(call({op:"save",note}))).status).toBe(500);
 expect(await readdir(join(vault,"ShowPilot"))).toEqual([]);
});

it("preserves custom Obsidian frontmatter on an approved edit", async()=>{
 const note={id:"metadata",category:"Preferences",title:"Directions",body:"Small steps",createdAt:"2026-10-31T12:00:00Z",updatedAt:"2026-10-31T12:00:00Z",source:"user-confirmed",tags:[]};
 await handleSecondBrain(call({op:"save",note}));
 const file=join(vault,"PixelPals/Preferences/Directions--metadata.md");
 const {writeFile}=await import("node:fs/promises");
 await writeFile(file,(await readFile(file,"utf8")).replace("type: pixel-pals-second-brain", "type: pixel-pals-second-brain\ncustom-field: keep-me"));
 const loaded=(await (await handleSecondBrain(new Request("http://localhost/api/second-brain"))).json()).notes[0];
 expect((await handleSecondBrain(call({op:"save",note:{...loaded,body:"Updated"},revision:loaded.revision}))).status).toBe(200);
 expect(await readFile(file,"utf8")).toContain("custom-field: keep-me");
});

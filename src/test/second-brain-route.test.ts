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
  expect((await handleSecondBrain(call({op:"trash",id:note.id,revision:saved.updatedAt}))).status).toBe(200);
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

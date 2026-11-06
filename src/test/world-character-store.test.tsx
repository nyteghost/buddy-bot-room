import {act,cleanup,renderHook,waitFor} from "@testing-library/react";
import {afterEach,beforeEach,describe,expect,it,vi} from "vitest";
import {useWorldCharacterUniverse} from "../lib/world-character-store";
import {CUSTOM_WORLD_KEY,starterCustomCharacter} from "../lib/world-custom-packs";
import {hdCharacter} from "./character-hd-fixture";
beforeEach(()=>localStorage.clear());
afterEach(()=>{cleanup();vi.restoreAllMocks();vi.unstubAllGlobals();});
const serverState=(characters:unknown[]=[],revision=0,enabled=["green-jacket"])=>({characters,revision,enabled});
describe("Character Universe browser recovery and saves",()=>{
 it("retains local original and recovery copy when server loads a different library",async()=>{
  const local=starterCustomCharacter();const remote=starterCustomCharacter();
  const original=JSON.stringify([local]);localStorage.setItem(CUSTOM_WORLD_KEY,original);
  vi.stubGlobal("fetch",vi.fn().mockResolvedValue(Response.json(serverState([remote]))));
  const {result}=renderHook(useWorldCharacterUniverse);
  await waitFor(()=>expect(result.current.state.server).toBe(true));
  expect(result.current.state.characters).toEqual([remote]);
  expect(localStorage.getItem(CUSTOM_WORLD_KEY)).toBe(original);
  expect(JSON.parse(result.current.recoveryBackup!).characters).toEqual([local]);
 });
 it("keeps state and original browser library on server write failure",async()=>{
  const original=JSON.stringify([starterCustomCharacter()]);localStorage.setItem(CUSTOM_WORLD_KEY,original);
  vi.stubGlobal("fetch",vi.fn().mockResolvedValueOnce(Response.json(serverState())).mockRejectedValue(new Error("offline")));
  const {result}=renderHook(useWorldCharacterUniverse);await waitFor(()=>expect(result.current.state.server).toBe(true));
  await act(async()=>{expect(await result.current.installPack([hdCharacter()])).toBe(false);});
  expect(result.current.state.characters).toEqual([]);expect(result.current.state.server).toBe(true);
  expect(localStorage.getItem(CUSTOM_WORLD_KEY)).toBe(original);
 });
 it("does not claim a local save succeeds when browser storage is full",async()=>{
  vi.stubGlobal("fetch",vi.fn().mockRejectedValue(new Error("offline")));
  const {result}=renderHook(useWorldCharacterUniverse);await waitFor(()=>expect(result.current.status).toContain("Stored in this browser"));
  vi.spyOn(Storage.prototype,"setItem").mockImplementation(()=>{throw new Error("quota");});
  await act(async()=>{expect(await result.current.save(starterCustomCharacter())).toBe(false);});
  expect(result.current.state.characters).toEqual([]);expect(result.current.status).toContain("unavailable or full");
 });
 it("serializes rapid visitor toggles against the latest saved revision",async()=>{
  const first=starterCustomCharacter(),second=starterCustomCharacter();let revision=0;
  const fetcher=vi.fn(async(_url:string,init?:RequestInit)=>{
   if(!init?.method)return Response.json(serverState([first,second]));
   const body=JSON.parse(String(init.body));expect(body.expectedRevision).toBe(revision++);
   return Response.json(serverState([first,second],revision,body.ids));
  });vi.stubGlobal("fetch",fetcher);
  const {result}=renderHook(useWorldCharacterUniverse);await waitFor(()=>expect(result.current.state.server).toBe(true));
  await act(async()=>{expect(await Promise.all([result.current.toggle(first.id,true),result.current.toggle(second.id,true)])).toEqual([true,true]);});
  expect(result.current.state.enabled).toEqual(["green-jacket",first.id,second.id]);
 });
});

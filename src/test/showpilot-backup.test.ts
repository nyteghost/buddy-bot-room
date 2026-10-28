import {describe,it,expect,vi} from "vitest";
import {exportWorkBackup,parseWorkBackup,restoreWorkBackup} from "@/lib/showpilot-backup";
describe("ShowPilot offline backup",()=>{
 it("only exports work-tool data, not secrets or personal Pixel Pals data",()=>{
  const data=new Map([["showpilot:vendors:v1","{}"],["stage-planner:plans","[]"],["pixelpals:floormap:abc","{}"],["pixelpals:work-name","Example"],["pixelpals:api-key","secret"],["unrelated","x"]]);
  const store={length:data.size,key:(i:number)=>Array.from(data.keys())[i]??null,getItem:(k:string)=>data.get(k)??null};
  const b=exportWorkBackup(store);expect(Object.keys(b.data)).toHaveLength(4);expect(JSON.stringify(b)).not.toContain("secret");
 });
 it("rejects untrusted backup keys",()=>{
  expect(()=>parseWorkBackup(JSON.stringify({kind:"showpilot-work-backup",version:1,data:{"pixelpals:api-key":"bad"}}))).toThrow(/unexpected/);
 });
 it("restores approved keys only",()=>{
  const setItem=vi.fn();
  const backup=parseWorkBackup(JSON.stringify({kind:"showpilot-work-backup",version:1,createdAt:"",data:{"showpilot:vendors:v1":"ok"}}));
  expect(restoreWorkBackup(backup,{setItem})).toBe(1);expect(setItem).toHaveBeenCalledWith("showpilot:vendors:v1","ok");
 });
});

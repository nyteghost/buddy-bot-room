import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { currentUser } from "@/lib/accounts.server";
import { askPals } from "@/lib/ask.server";
import { handleWorkingPals } from "@/lib/working-pals.server";

vi.mock("@/lib/accounts.server",()=>({currentUser:vi.fn()}));
vi.mock("@/lib/ask.server",()=>({askPals:vi.fn()}));
let root="";
const call = (body:Record<string,unknown>)=>handleWorkingPals(new Request("http://localhost/api/working-pals",{
  method:"POST",headers:{"content-type":"application/json"},body:JSON.stringify(body),
}));
const list=()=>handleWorkingPals(new Request("http://localhost/api/working-pals"));
beforeEach(async()=>{
  root=await mkdtemp(join(tmpdir(),"working-pals-"));
  vi.stubEnv("BUDDY_DATA_DIR",root);
  vi.mocked(currentUser).mockReset().mockResolvedValue({username:"owner",owner:true});
  vi.mocked(askPals).mockReset().mockResolvedValue({ok:true,text:"One tiny next step.",via:"Local AI"});
});
afterEach(async()=>{
  vi.unstubAllEnvs();
  if(root)await rm(root,{recursive:true,force:true});
  root="";
});
describe("Working Pals protected server flow",()=>{
  it("denies access to guests and doesn't run unapproved proposals",async()=>{
    vi.mocked(currentUser).mockResolvedValueOnce(null);
    expect((await list()).status).toBe(403);
    const proposed=await (await call({op:"propose",title:"First step",question:"What first?",scope:"personal",project:""})).json() as {mission:{id:string;revision:number}};
    expect((await call({op:"run",id:proposed.mission.id,revision:proposed.mission.revision})).status).toBe(409);
    expect(askPals).not.toHaveBeenCalled();
  });
  it("requires explicit approval, saves local-only results, and can revoke",async()=>{
    const proposal=await (await call({op:"propose",title:"Start",question:"What step?",scope:"personal",project:""})).json() as {mission:{id:string;revision:number}};
    const id=proposal.mission.id;
    const approved=await (await call({op:"approve",id,revision:1})).json() as {mission:{revision:number}};
    expect(approved.mission.revision).toBe(2);
    const response=await call({op:"run",id,revision:2});
    expect(response.status).toBe(200);
    expect(vi.mocked(askPals).mock.calls[0]?.[1]).toMatchObject({localOnly:true});
    const data=await (await list()).json() as {missions:{status:string;result:string;revision:number}[]};
    expect(data.missions[0]).toMatchObject({status:"completed",result:"One tiny next step."});
    const stale=await call({op:"revoke",id,revision:2});
    expect(stale.status).toBe(409);
    const rev=await call({op:"revoke",id,revision:data.missions[0]!.revision});
    expect(rev.status).toBe(200);
    expect((await call({op:"run",id,revision:data.missions[0]!.revision+1})).status).toBe(409);
  });
  it("records local inference failure accurately and requires confirmation to delete a job",async()=>{
    const p=await (await call({op:"propose",title:"Summary",question:"Help",scope:"personal",project:""})).json() as {mission:{id:string}};
    await call({op:"approve",id:p.mission.id,revision:1});
    vi.mocked(askPals).mockResolvedValueOnce({ok:false,error:"Local Ollama is offline"});
    expect((await call({op:"run",id:p.mission.id,revision:2})).status).toBe(409);
    const saved=await (await list()).json() as {missions:{revision:number;status:string;error:string}[]};
    expect(saved.missions[0]).toMatchObject({status:"failed",error:"Local Ollama is offline"});
    expect((await call({op:"remove",id:p.mission.id,revision:saved.missions[0]!.revision})).status).toBe(400);
    expect((await call({op:"remove",id:p.mission.id,revision:saved.missions[0]!.revision,confirm:true})).status).toBe(200);
    expect(((await (await list()).json()) as {missions:unknown[]}).missions).toHaveLength(0);
  });
  it("holds interrupted jobs for explicit approval-preserving retry",async()=>{
    const proposal=await (await call({op:"propose",title:"Test",question:"Recap?",scope:"personal",project:""})).json() as {mission:{id:string;revision:number}};
    await call({op:"approve",id:proposal.mission.id,revision:1});
    const database=JSON.parse(await readFile(join(root,"working-pals.json"),"utf8")) as {status:string;approvedAt:string;revision:number}[];
    database[0]!.status="running";
    await writeFile(join(root,"working-pals.json"),JSON.stringify(database));
    const response=await (await list()).json() as {missions:{status:string;error:string;revision:number}[]};
    expect(response.missions[0]?.status).toBe("interrupted");
    expect(response.missions[0]?.error).toContain("restart");
    expect(askPals).not.toHaveBeenCalled();
    expect((await call({op:"run",id:proposal.mission.id,revision:response.missions[0]?.revision})).status).toBe(200);
  });
});

it('requires separate recurring consent, runs once when due, retains receipts and pauses without deleting',async()=>{
  const {tickWorkingPals}=await import('@/lib/working-pals.server');
  const p=await (await call({op:'propose',title:'Recurring',question:'Plan one step',scope:'personal',project:''})).json();
  const id=p.mission.id;
  expect((await call({op:'schedule',id,revision:1,minutes:60,confirm:true})).status).toBe(409);
  await call({op:'approve',id,revision:1});
  expect((await call({op:'schedule',id,revision:2,minutes:60})).status).toBe(400);
  expect((await call({op:'schedule',id,revision:2,minutes:60,confirm:true})).status).toBe(200);
  expect(askPals).not.toHaveBeenCalled();
  const rows=JSON.parse(await readFile(join(root,'working-pals.json'),'utf8'));rows[0].schedule.next=1;
  await writeFile(join(root,'working-pals.json'),JSON.stringify(rows));
  await tickWorkingPals();await tickWorkingPals();expect(askPals).toHaveBeenCalledTimes(1);
  let saved=(await (await list()).json()).missions[0];
  await call({op:'run',id,revision:saved.revision});
  saved=(await (await list()).json()).missions[0];expect(saved.receipts).toHaveLength(1);expect(saved.receipts[0].result).toBe('One tiny next step.');
  await call({op:'pause-all'});saved=(await (await list()).json()).missions[0];expect(saved.schedule.enabled).toBe(false);expect(saved.status).toBe('paused');expect(saved.result).toBe('One tiny next step.');
});
it('revocation prevents a late inference result from replacing stored state',async()=>{
  let finish!:(value:{ok:true;text:string;via:string})=>void;
  vi.mocked(askPals).mockImplementationOnce(()=>new Promise(r=>{finish=r;}));
  const p=await (await call({op:'propose',title:'Slow',question:'Plan',scope:'personal',project:''})).json();
  await call({op:'approve',id:p.mission.id,revision:1});
  const running=call({op:'run',id:p.mission.id,revision:2});
  await vi.waitFor(()=>expect(finish).toBeDefined());
  const m=(await (await list()).json()).missions[0];
  await call({op:'revoke',id:m.id,revision:m.revision});
  finish({ok:true,text:'Late output',via:'Local AI'});await running;
  const saved=(await (await list()).json()).missions[0];expect(saved.status).toBe('revoked');expect(saved.result).not.toContain('Late output');
});

it("foreground chat cancels background inference without retaining its late reply",async()=>{
  const {foregroundStart, foregroundEnd}=await import('@/lib/memory-keeper.server');
  let finish!:(value:{ok:true;text:string;via:string})=>void;
  vi.mocked(askPals).mockImplementationOnce(()=>new Promise(r=>{finish=r;}));
  const p=await (await call({op:'propose',title:'Background',question:'Plan',scope:'personal',project:''})).json();
  await call({op:'approve',id:p.mission.id,revision:1});
  const running=call({op:'run',id:p.mission.id,revision:2});
  await vi.waitFor(()=>expect(finish).toBeDefined());
  await foregroundStart();
  try {
    finish({ok:true,text:'Late background output',via:'Local AI'});await running;
    const saved=(await (await list()).json()).missions[0];
    expect(saved.status).toBe('paused');expect(saved.result).not.toContain('Late background output');
  } finally { foregroundEnd(); }
});

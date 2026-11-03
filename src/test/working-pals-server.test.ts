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

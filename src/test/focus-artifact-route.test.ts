import {beforeEach,afterEach,expect,it,vi} from "vitest";
import {currentUser} from "@/lib/accounts.server";
import {askPals} from "@/lib/ask.server";
import {handlePalWork} from "@/lib/focus-artifact.server";
vi.mock("@/lib/accounts.server",()=>({currentUser:vi.fn()}));
vi.mock("@/lib/ask.server",()=>({askPals:vi.fn()}));
beforeEach(()=>{vi.stubEnv("BUDDY_ACCOUNTS","1");vi.stubEnv("BUDDY_DATA_DIR","/tmp/pixelpals-focus-artifact-tests");vi.mocked(currentUser).mockResolvedValue({username:"owner",owner:true});vi.mocked(askPals).mockReset();});
afterEach(()=>vi.unstubAllEnvs());
const req=(body:unknown)=>new Request("http://localhost/api/pal-work",{method:"POST",headers:{"content-type":"application/json"},body:JSON.stringify(body)});
it("denies non-owners and never calls other AI providers",async()=>{
 vi.mocked(currentUser).mockResolvedValue(null);
 expect((await handlePalWork(req({task:"Write a report"}))).status).toBe(403);
 expect(askPals).not.toHaveBeenCalled();
});
it("never edits anything and uses local AI only on explicit request",async()=>{
 vi.mocked(askPals).mockResolvedValue({ok:true,text:"Sample outline:\\n1. Main objective\\n2. First fact",via:"local"});
 const response=await handlePalWork(req({task:"Write a report"}));
 expect((await response.json()).source).toBe("local-ai");
 expect(askPals).toHaveBeenCalledWith(expect.any(String),expect.objectContaining({localOnly:true}));
});
it("does not accept invented assembly steps from AI",async()=>{
 vi.mocked(askPals).mockResolvedValue({ok:true,text:"Drill holes then tighten bolts",via:"local"});
 const res=await handlePalWork(req({task:"Build a swingset"}));
 expect((await res.json()).source).toBe("offline-example");
});

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { mkdtemp, readFile, rm, mkdir } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { currentUser } from "@/lib/accounts.server";
import { completedMeetingSources } from "@/lib/meeting-vault.server";
import { reviewedMeetingForThread } from "@/lib/meeting-review.server";
import { handleMeetingThreads } from "@/lib/meeting-threads.server";
import type { MeetingThreadHit } from "@/lib/meeting-threads";

vi.mock("@/lib/accounts.server",()=>({currentUser:vi.fn()}));
vi.mock("@/lib/meeting-vault.server",()=>({completedMeetingSources:vi.fn()}));
vi.mock("@/lib/meeting-review.server",()=>({reviewedMeetingForThread:vi.fn()}));
const id="e6d9db14-4a7a-477a-95a1-ff3c5d2dd422";
const second="b4a08f69-0a2e-48ba-9802-a796704cd559";
let root="";
const api=(query="")=>handleMeetingThreads(new Request("http://localhost/api/meeting-threads?q="+encodeURIComponent(query)));
const post=(body:Record<string,unknown>)=>handleMeetingThreads(new Request("http://localhost/api/meeting-threads",{
  method:"POST",headers:{"content-type":"application/json"},body:JSON.stringify(body),
}));
beforeEach(async()=>{
  root=await mkdtemp(join(tmpdir(),"meeting-threads-"));
  await mkdir(join(root,"meeting-vault"));
  vi.stubEnv("BUDDY_DATA_DIR",root);
  vi.mocked(currentUser).mockReset().mockResolvedValue({username:"owner",owner:true});
  vi.mocked(completedMeetingSources).mockReset().mockResolvedValue([
    {id,title:"Blue Lantern planning",status:"ready",sha256:"a".repeat(64)},
    {id:second,title:"Private draft only",status:"ready",sha256:"b".repeat(64)},
  ] as Awaited<ReturnType<typeof completedMeetingSources>>);
  vi.mocked(reviewedMeetingForThread).mockReset().mockImplementation(async meeting=>{
    return meeting===id ? {
      meetingId:id,status:"reviewed",approvedAt:"2026-11-02T10:00:00Z",
      summary:"Blue Lantern project decisions reviewed.",transcript:"[00:00:00 - 00:03:00] Confirmed lighting needs.",
    } as Awaited<ReturnType<typeof reviewedMeetingForThread>> : null;
  });
});
afterEach(async()=>{vi.unstubAllEnvs();await rm(root,{recursive:true,force:true});root="";});
describe("Meeting Threads approved-only index",()=>{
  it("refuses guests and never searches unreviewed draft notes",async()=>{
    vi.mocked(currentUser).mockResolvedValueOnce(null);
    expect((await api()).status).toBe(403);
    const result=await (await api("Private draft only")).json() as {items:MeetingThreadHit[]};
    expect(result.items).toHaveLength(0);
    const matches=await (await api("Blue Lantern")).json() as {items:MeetingThreadHit[]};
    expect(matches.items.map(x=>x.meetingId)).toEqual([id]);
  });
  it("requires an explicit approved link and protects it with revision checks",async()=>{
    expect((await post({op:"link",id,thread:"Planning",project:"showpilot",revision:0})).status).toBe(200);
    const linked=await (await api()).json() as {items:MeetingThreadHit[]};
    expect(linked.items[0]).toMatchObject({thread:"Planning",project:"showpilot",linkRevision:1});
    const stale=await post({op:"link",id,thread:"New",project:"",revision:0});
    expect(stale.status).toBe(409);
    const saved=JSON.parse(await readFile(join(root,"meeting-vault","threads.json"),"utf8")) as unknown[];
    expect(saved).toHaveLength(1);
    expect((await post({op:"unlink",id,revision:1})).status).toBe(200);
    expect((await post({op:"unlink",id,revision:1})).status).toBe(409);
    expect((await (await api()).json() as {items:MeetingThreadHit[]}).items[0]?.thread).toBe("");
  });
  it("prepares a private brief only after an explicit owner-approved thread link",async()=>{
    const noLinks=await handleMeetingThreads(new Request("http://localhost/api/meeting-threads?brief=Planning&project=home"));
    expect(noLinks.status).toBe(404);
    expect((await post({op:"link",id,thread:"Planning",project:"home",revision:0})).status).toBe(200);
    const good=await handleMeetingThreads(new Request("http://localhost/api/meeting-threads?brief=Planning&project=home"));
    expect(good.status).toBe(200);
    const data=await good.json() as {brief:{text:string;sources:{meetingId:string}[]}};
    expect(data.brief.sources.map(x=>x.meetingId)).toEqual([id]);
    expect(data.brief.text).toContain("Blue Lantern project decisions reviewed.");
    expect((await handleMeetingThreads(new Request("http://localhost/api/meeting-threads?brief=Planning&project=other"))).status).toBe(404);
    vi.mocked(currentUser).mockResolvedValueOnce(null);
    expect((await handleMeetingThreads(new Request("http://localhost/api/meeting-threads?brief=Planning&project=home"))).status).toBe(403);
  });
  it("never allows linking an unreviewed meeting or granting permissions via project labels",async()=>{
    expect((await post({op:"link",id:second,thread:"Draft",project:"private",revision:0})).status).toBe(409);
    expect((await post({op:"link",id,thread:"Planning",project:"../outside",revision:0})).status).toBe(400);
  });
});

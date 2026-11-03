import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createHash } from "node:crypto";
import { mkdtemp, readFile, rm, stat } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { currentUser } from "@/lib/accounts.server";
import { handleMeetingVault } from "@/lib/meeting-vault.server";
import { MEETING_CHUNK_BYTES, type MeetingRecord } from "@/lib/meeting-vault";

vi.mock("@/lib/accounts.server",()=>({currentUser:vi.fn()}));
let folder="";
const api=(body:Record<string,unknown>)=>handleMeetingVault(new Request("http://localhost/api/meeting-vault",{
  method:"POST",headers:{"content-type":"application/json"},body:JSON.stringify(body),
}));
const listing=()=>handleMeetingVault(new Request("http://localhost/api/meeting-vault"));
const part=(id:string,n:number,buffer:Uint8Array,hash?:string)=>{
  const digest=hash??createHash("sha256").update(buffer).digest("hex");
  const bytes=new Uint8Array(buffer);
  return handleMeetingVault(new Request("http://localhost/api/meeting-vault?id="+id+"&part="+n,{
    method:"PUT",headers:{"x-chunk-sha256":digest,"content-type":"application/octet-stream"},body:new Blob([bytes]),
  }));
};
const make=async(bytes:number)=>{
  const r=await api({op:"create",title:"Planning",filename:"planning.m4a",
    mimeType:"audio/mp4",bytes,consentConfirmed:true,source:"iphone-voice-memos"});
  expect(r.status).toBe(201);
  return ((await r.json()) as {record:MeetingRecord}).record;
};
beforeEach(async()=>{
  folder=await mkdtemp(join(tmpdir(),"meeting-vault-test-"));
  vi.stubEnv("BUDDY_DATA_DIR",folder);
  vi.mocked(currentUser).mockReset().mockResolvedValue({username:"owner",owner:true});
});
afterEach(async()=>{
  vi.unstubAllEnvs();
  await rm(folder,{recursive:true,force:true});folder="";
});
describe("Meeting Vault secure streaming and recovery",()=>{
  it("rejects unauthorized access and non-consensual imports without writing audio",async()=>{
    vi.mocked(currentUser).mockResolvedValue(null);
    expect((await listing()).status).toBe(403);
    expect((await api({op:"create",title:"Private",filename:"call.m4a",mimeType:"audio/mp4",bytes:1000,consentConfirmed:true})).status).toBe(403);
    vi.mocked(currentUser).mockResolvedValue({username:"owner",owner:true});
    expect((await api({op:"create",title:"Private",filename:"call.m4a",mimeType:"audio/mp4",bytes:1000,consentConfirmed:false})).status).toBe(400);
    expect(((await (await listing()).json()) as {meetings:unknown[]}).meetings).toEqual([]);
  });
  it("resumes and verifies chunks, rejects changed retries, finalizes without changing original audio",async()=>{
    const bytes=new Uint8Array(MEETING_CHUNK_BYTES+7).fill(65);
    bytes.set([1,2,3,4,5,6,7],MEETING_CHUNK_BYTES);
    const record=await make(bytes.length);
    expect((await part(record.id,0,bytes.slice(0,MEETING_CHUNK_BYTES),"0".repeat(64))).status).toBe(422);
    expect((await part(record.id,0,bytes.slice(0,MEETING_CHUNK_BYTES))).status).toBe(200);
    expect((await part(record.id,0,bytes.slice(0,MEETING_CHUNK_BYTES))).status).toBe(200);
    const altered=new Uint8Array(MEETING_CHUNK_BYTES).fill(66);
    expect((await part(record.id,0,altered)).status).toBe(409);
    expect((await api({op:"finalize",id:record.id})).status).toBe(409);
    const before=(await (await listing()).json()) as {meetings:MeetingRecord[]};
    expect(before.meetings[0]?.received).toEqual([0]);
    expect((await part(record.id,1,bytes.slice(MEETING_CHUNK_BYTES))).status).toBe(200);
    const completed=await api({op:"finalize",id:record.id});
    expect(completed.status).toBe(200);
    const final=(await completed.json()) as {record:MeetingRecord};
    expect(final.record.status).toBe("ready");
    expect(final.record.sha256).toBe(createHash("sha256").update(bytes).digest("hex"));
    expect((await readFile(join(folder,"meeting-vault",record.id,"original.m4a"))).equals(Buffer.from(bytes))).toBe(true);
    expect((await api({op:"finalize",id:record.id})).status).toBe(200);
    const st=await stat(join(folder,"meeting-vault",record.id,"original.m4a"));
    expect(st.mode & 0o777).toBe(0o600);
    expect((await handleMeetingVault(new Request("http://localhost/api/meeting-vault?id="+record.id+"&audio=1",{
      headers:{Range:"bytes=0-3"},
    }))).status).toBe(206);
    const audio=await handleMeetingVault(new Request("http://localhost/api/meeting-vault?id="+record.id+"&audio=1"));
    expect(audio.status).toBe(200);
    expect(new Uint8Array(await audio.arrayBuffer())).toEqual(bytes);
  });
  it("requires revision and explicit confirmation to delete originals",async()=>{
    const record=await make(4);
    const blob=new Uint8Array([9,7,5,3]);
    await part(record.id,0,blob);
    const final=await (await api({op:"finalize",id:record.id})).json() as {record:MeetingRecord};
    expect((await api({op:"remove",id:record.id,revision:final.record.revision})).status).toBe(400);
    expect((await api({op:"remove",id:record.id,revision:record.revision,confirm:true})).status).toBe(409);
    expect((await api({op:"remove",id:record.id,revision:final.record.revision,confirm:true})).status).toBe(200);
    expect(((await (await listing()).json()) as {meetings:unknown[]}).meetings).toHaveLength(0);
  });
});

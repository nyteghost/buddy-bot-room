import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { mkdir, mkdtemp, rm, writeFile, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { currentUser } from "@/lib/accounts.server";
import { meetingSourceForReview, meetingOriginalForTranscription } from "@/lib/meeting-vault.server";
import { reviewForLocalTranscription, acceptLocalTranscription } from "@/lib/meeting-review.server";
import { handleMeetingTranscribe } from "@/lib/meeting-transcribe.server";
import { freshTranscription, type MeetingTranscription } from "@/lib/meeting-transcribe";

vi.mock("@/lib/accounts.server",()=>({currentUser:vi.fn()}));
vi.mock("@/lib/meeting-vault.server",()=>({
  meetingSourceForReview:vi.fn(),meetingOriginalForTranscription:vi.fn(),
}));
vi.mock("@/lib/meeting-review.server",()=>({
  reviewForLocalTranscription:vi.fn(),acceptLocalTranscription:vi.fn(),
}));
const id="56a66cff-9a2d-4ba0-adac-8e46673b0044";
let dir="";
const get=()=>handleMeetingTranscribe(new Request("http://localhost/api/meeting-transcribe?id="+id));
const call=(data:Record<string,unknown>)=>handleMeetingTranscribe(new Request("http://localhost/api/meeting-transcribe",{
  method:"POST",headers:{"content-type":"application/json"},body:JSON.stringify({id,...data}),
}));
beforeEach(async()=>{
  dir=await mkdtemp(join(tmpdir(),"meeting-whisper-"));
  await mkdir(join(dir,"meeting-vault",id),{recursive:true});
  vi.stubEnv("BUDDY_DATA_DIR",dir);
  vi.stubEnv("WHISPER_URL","");
  vi.mocked(currentUser).mockReset().mockResolvedValue({username:"owner",owner:true});
  vi.mocked(meetingSourceForReview).mockReset().mockResolvedValue({
    id,title:"A meeting",sha256:"a".repeat(64),status:"ready",
  } as Awaited<ReturnType<typeof meetingSourceForReview>>);
  vi.mocked(meetingOriginalForTranscription).mockReset();
  vi.mocked(reviewForLocalTranscription).mockReset().mockResolvedValue({
    meetingId:id,revision:1,transcript:"",status:"draft",
  } as Awaited<ReturnType<typeof reviewForLocalTranscription>>);
  vi.mocked(acceptLocalTranscription).mockReset();
});
afterEach(async()=>{
  vi.unstubAllEnvs();
  await rm(dir,{recursive:true,force:true});
  dir="";
});
describe("Owner-only local transcription command boundaries",()=>{
  it("rejects all anonymous access and rejects unapproved outbound audio jobs",async()=>{
    vi.mocked(currentUser).mockResolvedValueOnce(null);
    expect((await get()).status).toBe(403);
    expect((await call({op:"start"})).status).toBe(400);
    expect((await call({op:"start",confirm:true})).status).toBe(503);
    vi.stubEnv("WHISPER_URL","https://api.public-whisper.example.com");
    expect((await call({op:"start",confirm:true})).status).toBe(503);
    expect(meetingOriginalForTranscription).not.toHaveBeenCalled();
  });
  it("never overwrites existing reviewed transcripts or follows external jobs",async()=>{
    vi.stubEnv("WHISPER_URL","http://whisper:9000");
    vi.mocked(reviewForLocalTranscription).mockResolvedValueOnce({
      meetingId:id,revision:2,transcript:"Already reviewed by owner",status:"draft",
    } as Awaited<ReturnType<typeof reviewForLocalTranscription>>);
    expect((await call({op:"start",confirm:true})).status).toBe(409);
    expect(acceptLocalTranscription).not.toHaveBeenCalled();
  });
  it("marks interrupted jobs for manual retry and requires confirmation before resetting checkpoints",async()=>{
    const state={...freshTranscription(id),status:"running" as const,reviewRevision:1,totalSegments:4,finishedSegments:2};
    await writeFile(join(dir,"meeting-vault",id,"transcription.json"),JSON.stringify(state));
    const data=await (await get()).json() as {status:MeetingTranscription};
    expect(data.status.status).toBe("interrupted");
    expect(data.status.finishedSegments).toBe(2);
    expect((await call({op:"reset"})).status).toBe(400);
    expect((await call({op:"reset",confirm:true})).status).toBe(200);
    const reset=JSON.parse(await readFile(join(dir,"meeting-vault",id,"transcription.json"),"utf8")) as MeetingTranscription;
    expect(reset.status).toBe("idle");
    expect(reset.finishedSegments).toBe(0);
  });
});

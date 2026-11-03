import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { mkdir, mkdtemp, readFile, readdir, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { currentUser } from "@/lib/accounts.server";
import { askPals } from "@/lib/ask.server";
import { meetingSourceForReview } from "@/lib/meeting-vault.server";
import { handleMeetingReview } from "@/lib/meeting-review.server";
import { emptyMeetingReview, type MeetingReview } from "@/lib/meeting-review";

vi.mock("@/lib/accounts.server",()=>({currentUser:vi.fn()}));
vi.mock("@/lib/ask.server",()=>({askPals:vi.fn()}));
vi.mock("@/lib/meeting-vault.server",()=>({meetingSourceForReview:vi.fn()}));
const id="e6d9db14-4a7a-477a-95a1-ff3c5d2dd422";
let root="";
let vault="";
const get=()=>handleMeetingReview(new Request("http://localhost/api/meeting-review?id="+id));
const change=(payload:Record<string,unknown>)=>handleMeetingReview(new Request("http://localhost/api/meeting-review",{
  method:"POST",headers:{"content-type":"application/json"},body:JSON.stringify({id,...payload}),
}));
const data=async()=>((await (await get()).json()) as {review:MeetingReview}).review;
beforeEach(async()=>{
  root=await mkdtemp(join(tmpdir(),"meeting-review-"));
  vault=join(root,"obsidian");
  await mkdir(vault);
  await mkdir(join(root,"meeting-vault",id),{recursive:true});
  vi.stubEnv("BUDDY_DATA_DIR",root);
  vi.stubEnv("OBSIDIAN_VAULT_DIR",vault);
  vi.mocked(currentUser).mockReset().mockResolvedValue({username:"owner",owner:true});
  vi.mocked(meetingSourceForReview).mockReset().mockResolvedValue({
    id,title:"Project meeting",sha256:"a".repeat(64),status:"ready",
  } as Awaited<ReturnType<typeof meetingSourceForReview>>);
  vi.mocked(askPals).mockReset().mockResolvedValue({ok:true,text:"Draft decisions and next steps.",via:"Local AI"});
});
afterEach(async()=>{
  vi.unstubAllEnvs();
  await rm(root,{recursive:true,force:true});
  root="";vault="";
});
describe("Meeting Review owner-only, revisioned workflow",()=>{
  it("refuses guests and never publishes without owner review",async()=>{
    vi.mocked(currentUser).mockResolvedValueOnce(null);
    expect((await get()).status).toBe(403);
    const initial=await data();
    expect(initial.status).toBe("draft");
    expect((await change({op:"publish",revision:1})).status).toBe(409);
    expect((await change({op:"approve",revision:1})).status).toBe(400);
    expect(askPals).not.toHaveBeenCalled();
    expect(await readdir(vault)).toEqual([]);
  });
  it("requires saved transcript, uses local-only AI and publishes only approved notes",async()=>{
    const start=emptyMeetingReview(id);
    expect((await change({op:"save",revision:start.revision,transcript:"We will review project status.",
      summary:"",speakerNotes:"Speaker assignment unknown."})).status).toBe(200);
    const version=await data();
    expect(version.revision).toBe(2);
    expect((await change({op:"save",revision:1,transcript:"overwrite",summary:"",speakerNotes:""})).status).toBe(409);
    expect((await change({op:"summarize",revision:2})).status).toBe(200);
    expect(vi.mocked(askPals).mock.calls.at(-1)?.[1]).toMatchObject({localOnly:true});
    const drafted=await data();
    expect(drafted.status).toBe("draft");
    expect(drafted.summary).toContain("Draft decisions");
    expect((await change({op:"publish",revision:drafted.revision})).status).toBe(409);
    expect((await change({op:"approve",revision:drafted.revision})).status).toBe(200);
    const approved=await data();
    expect(approved.status).toBe("reviewed");
    const exported=await change({op:"publish",revision:approved.revision});
    expect(exported.status).toBe(200);
    const final=await data();
    expect(final.exportedPath).toContain(id);
    const original=await readFile(join(vault,final.exportedPath),"utf8");
    expect(original).toContain("Project meeting");
    expect(original).toContain("We will review project status.");
    expect((await change({op:"publish",revision:final.revision})).status).toBe(200);
    expect(await readFile(join(vault,final.exportedPath),"utf8")).toBe(original);
    expect((await change({op:"save",revision:final.revision,transcript:"Updated decision",summary:"Updated summary",speakerNotes:""})).status).toBe(200);
    const updated=await data();
    expect(updated.status).toBe("draft");
    expect((await change({op:"approve",revision:updated.revision})).status).toBe(200);
    const newest=await data();
    expect((await change({op:"publish",revision:newest.revision})).status).toBe(200);
    const second=await data();
    expect(second.exportedPath).not.toBe(final.exportedPath);
    expect(await readFile(join(vault,final.exportedPath),"utf8")).toBe(original);
  });
  it("never follows symlinked Obsidian Meetings folder",async()=>{
    await mkdir(join(vault,"Pixel Pals"));
    const target=join(root,"outside");await mkdir(target);
    await symlink(target,join(vault,"Pixel Pals","Meetings"));
    await change({op:"save",revision:1,transcript:"Confirmed.",summary:"Approved summary.",speakerNotes:""});
    const saved=await data();
    await change({op:"approve",revision:saved.revision});
    const approved=await data();
    expect((await change({op:"publish",revision:approved.revision})).status).toBe(500);
    expect(await readdir(target)).toEqual([]);
  });
  it("never overwrites a hand-created note of the same revision",async()=>{
    await change({op:"save",revision:1,transcript:"Conversation",summary:"Summary",speakerNotes:""});
    const saved=await data();
    await change({op:"approve",revision:saved.revision});
    const approved=await data();
    const dir=join(vault,"Pixel Pals","Meetings");await mkdir(dir,{recursive:true});
    const collision=join(dir,id+"-r"+approved.revision+".md");
    await writeFile(collision,"A manually edited note must survive");
    expect((await change({op:"publish",revision:approved.revision})).status).toBe(409);
    expect(await readFile(collision,"utf8")).toBe("A manually edited note must survive");
  });
});

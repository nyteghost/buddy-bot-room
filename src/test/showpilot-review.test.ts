import { describe, it, expect } from "vitest";
import type { EventEntry, EventRow, TaskNote } from "@/lib/work-tools";
import {
  applyReview, emptyReviewDraft, fingerprintRows, keyedProposals, parseDraft, parseReviewProject, storageKey,
} from "@/lib/showpilot-review";

const event = (title: string, code: EventEntry["code"] = "S"): EventEntry => ({
  date:"2026-10-12",space:"Hall A",title,code,start:480,end:1020,eventId:"501",
});
const note:TaskNote={date:"2026-10-12",section:"HALLS",text:"Stage: risers"};
const row=(description:string):EventRow=>({level:2,usage:"",date:"2026-10-12",space:"Exhibit Hall A (EXA)",description,start:"08:00 AM",end:"05:00 PM",event:"Sample"});
describe("ShowPilot immutable source/review model", () => {
  it("retains imported proposals and returns edits only in the final layer",()=>{
    const before=[event("Show")];
    const id=keyedProposals(before)[0]!.id;
    const d=emptyReviewDraft();d.entries[id]={action:"replace",value:{...before[0]!,title:"Approved abbreviation",end:1100}};
    const r=applyReview(before,[note],d);
    expect(r.entries[0]?.title).toBe("Approved abbreviation");
    expect(r.entryLines[0]?.source?.title).toBe("Show");
    expect(before[0]?.title).toBe("Show");
    expect(r.entryLines[0]?.status).toBe("edited");
    expect(r.tasks).toEqual([note]);
  });
  it("tracks both removals and additions without destroying the original",()=>{
    const base=[event("One"),event("Two")];
    const d=emptyReviewDraft();
    d.entries[keyedProposals(base)[0]!.id]={action:"remove"};
    d.addedEntries=[{id:"manual",value:event("Manual","MI")}];
    const r=applyReview(base,[],d);
    expect(r.entries.map(e=>e.title)).toEqual(["Two","Manual"]);
    expect(r.entryLines.map(x=>x.status)).toEqual(["removed","unchanged","added"]);
  });
  it("preserves duplicate activity lines with occurrence-aware keys",()=>{
    const e=event("Same");
    const keyed=keyedProposals([e,e]);
    expect(keyed[0]?.id).not.toBe(keyed[1]?.id);
    const d=emptyReviewDraft();d.entries[keyed[0]!.id]={action:"remove"};
    expect(applyReview([e,e],[],d).entries).toHaveLength(1);
  });
  it("preserves proposed tasks and supports manual corrections",()=>{
    const d=emptyReviewDraft();d.tasks[keyedProposals([note])[0]!.id]={action:"replace",value:{...note,text:"Make Hall AB"}};
    d.addedTasks=[{id:"custom",value:{...note,text:"Stage delivery"}}];
    expect(applyReview([], [note], d).tasks.map(x=>x.text)).toEqual(["Make Hall AB","Stage delivery"]);
  });
  it("detects unmatched changes after source classifications change",()=>{
    const d=emptyReviewDraft();d.entries["stale key"]={action:"remove"};
    expect(applyReview([event("New")],[],d).unmatchedChanges).toBe(1);
  });
  it("rejects invalid times and CEPAC manual entries",()=>{
    const d=emptyReviewDraft();
    d.addedEntries=[{id:"bad1",value:{...event("Bad"),start:1500,end:1440}},
                    {id:"bad2",value:{...event("Bad"),space:"CEPAC Theatre"}},
                    {id:"good",value:{...event("Late"),start:1380,end:1560}}];
    expect(applyReview([],[],d).entries.map(x=>x.title)).toEqual(["Late"]);
  });
  it("keeps drafts scoped to the original report and parses project backups",()=>{
    const rows=[row("Move In"),row("Show")];
    const h=fingerprintRows(rows);
    expect(h).toBe(fingerprintRows(rows));
    expect(h).not.toBe(fingerprintRows([row("Changed")]));
    expect(storageKey(h)).toMatch(/^showpilot:review:v1:/);
    const draft=emptyReviewDraft();
    const project={kind:"showpilot-review-project",version:1,originalRows:rows,draft,approvedSpaces:["Meeting Room 101"],includePending:false,note:""};
    expect(parseReviewProject(JSON.stringify(project)).originalRows).toEqual(rows);
    expect(parseDraft(JSON.stringify(draft))).toEqual(draft);
  });
  it("refuses malformed or out-of-scope project data",()=>{
    expect(()=>parseReviewProject('{"kind":"unknown"}')).toThrow();
    expect(()=>parseDraft(JSON.stringify({version:1,entries:{"x":{"action":"unknown"}},tasks:{},addedEntries:[],addedTasks:[]}))).toThrow();
  });
});

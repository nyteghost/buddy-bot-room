import { createHash, randomUUID } from "node:crypto";
import { describe, expect, it } from "vitest";
import { MEETING_CHUNK_BYTES, MEETING_MAX_BYTES, newMeeting, parseMeetingMeta, partLength } from "@/lib/meeting-vault";

const id="9fe4e7d4-ea39-4b8d-8efa-cb63c1620ba2";
const at="2026-11-02T20:20:00Z";
describe("Meeting Vault long-audio record validation",()=>{
  it("requires explicit consent and known audio types; rejects invalid sizes",()=>{
    const fields={title:"Team planning",filename:"meeting.m4a",mimeType:"audio/mp4",bytes:1000,source:"iphone-voice-memos"};
    expect(newMeeting(fields,id,at)).toBeNull();
    expect(newMeeting({...fields,consentConfirmed:true,mimeType:"application/octet-stream"},id,at)).toBeNull();
    expect(newMeeting({...fields,consentConfirmed:true,bytes:MEETING_MAX_BYTES+1},id,at)).toBeNull();
    expect(newMeeting({...fields,consentConfirmed:true,bytes:0},id,at)).toBeNull();
  });
  it("sanitizes filenames and chunks exactly without rewriting the original format",()=>{
    const m=newMeeting({title:"Planning",filename:"../private\\call.m4a",mimeType:"audio/mp4",
      bytes:MEETING_CHUNK_BYTES+19,consentConfirmed:true},id,at)!;
    expect(m.filename).toBe("call.m4a");
    expect(m.parts).toBe(2);
    expect(partLength(m,0)).toBe(MEETING_CHUNK_BYTES);
    expect(partLength(m,1)).toBe(19);
    expect(parseMeetingMeta(m)).toEqual(m);
    expect(parseMeetingMeta({...m,received:[0,0]})).toBeNull();
    expect(parseMeetingMeta({...m,received:[2]})).toBeNull();
    expect(parseMeetingMeta({...m,consentConfirmed:false})).toBeNull();
    expect(createHash("sha256").update(randomUUID()).digest("hex")).toHaveLength(64);
  });
});

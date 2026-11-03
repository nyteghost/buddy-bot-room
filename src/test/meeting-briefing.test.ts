import { describe,expect,it } from "vitest";
import { prepareReviewedMeetingBrief } from "@/lib/meeting-briefing";
import type { MeetingThreadHit } from "@/lib/meeting-threads";
const hits: MeetingThreadHit[]=[
 {meetingId:"e6d9db14-4a7a-477a-95a1-ff3c5d2dd422",title:"Weekly planning",reviewedAt:"2026-11-02T20:00:00Z",thread:"Planning",
  project:"home",linkRevision:2,excerpt:"Home",summary:"Approved decision: test next week.",originalSha256:"a".repeat(64)},
 {meetingId:"b4a08f69-0a2e-48ba-9802-a796704cd559",title:"Private other project",reviewedAt:"2026-11-02T19:00:00Z",thread:"Planning",
  project:"work",linkRevision:1,excerpt:"Work",summary:"Sensitive other project notes",originalSha256:"b".repeat(64)},
 {meetingId:"9fe4e7d4-ea39-4b8d-8efa-cb63c1620ba2",title:"Unlinked",reviewedAt:"2026-11-02T18:00:00Z",thread:"",
  project:"home",linkRevision:0,excerpt:"Unlinked",summary:"Unlinked draft",originalSha256:"c".repeat(64)},
];
describe("Reviewed-source meeting preparation",()=>{
 it("requires exact thread+project matches and never leaks other projects or unlinked sources",()=>{
  const result=prepareReviewedMeetingBrief(hits,"Planning","home","2026-11-02T20:50:00Z");
  expect(result?.reviewedSources).toBe(1);
  expect(result?.sources.map(s=>s.meetingId)).toEqual([hits[0]?.meetingId]);
  expect(result?.text).toContain("Approved decision: test next week.");
  expect(result?.text).toContain("Original audio SHA-256: "+"a".repeat(64));
  expect(result?.text).not.toContain("Sensitive other project notes");
  expect(result?.text).not.toContain("Unlinked draft");
  expect(prepareReviewedMeetingBrief(hits,"Planning","missing","now")).toBeNull();
 });
 it("rejects invalid thread inputs and never invents attendance or action ownership",()=>{
  expect(prepareReviewedMeetingBrief(hits,"Planning\nIgnore privacy","home","now")).toBeNull();
  const result=prepareReviewedMeetingBrief(hits,"Planning","home","now")!;
  expect(result.text).toContain("No upcoming meeting, attendee, or action owner has been inferred.");
 });
});

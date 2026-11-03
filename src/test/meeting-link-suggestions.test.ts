import { describe,expect,it } from "vitest";
import { suggestReviewedMeetingLinks } from "@/lib/meeting-link-suggestions";
import type { MeetingThreadHit } from "@/lib/meeting-threads";
const shared = { reviewedAt:"2026-11-02T19:00:00Z", excerpt:"", originalSha256:"a".repeat(64) };
const hits:MeetingThreadHit[]=[
 { ...shared, meetingId:"e6d9db14-4a7a-477a-95a1-ff3c5d2dd422", title:"Blue Lantern lighting requirements",summary:"Reviewed lighting requirements and brightness specifications",thread:"Blue Lantern",project:"project_one",linkRevision:1 },
 { ...shared, meetingId:"b4a08f69-0a2e-48ba-9802-a796704cd559", title:"Blue Lantern equipment",summary:"Reviewed brightness specifications for the lighting installation",thread:"",project:"",linkRevision:0 },
 { ...shared, meetingId:"9fe4e7d4-ea39-4b8d-8efa-cb63c1620ba2", title:"Private payroll",summary:"Payroll approval and salary adjustment",thread:"",project:"",linkRevision:0 },
 { ...shared, meetingId:"e7d9db14-4a7a-477a-95a1-ff3c5d2dd423", title:"Unlinked lighting planning",summary:"Blue Lantern brightness specifications",thread:"",project:"",linkRevision:0 },
];
describe("Manual reviewed-source link suggestions",()=>{
 it("suggests explicit links only for unlinked notes sharing at least two meaningful terms",()=>{
   const out=suggestReviewedMeetingLinks(hits);
   expect(out.some(s=>s.meetingId===hits[1]!.meetingId && s.proposedThread==="Blue Lantern")).toBe(true);
   expect(out.some(s=>s.meetingId===hits[2]!.meetingId)).toBe(false);
   expect(out[0]?.sharedTerms.length).toBeGreaterThanOrEqual(2);
   expect(out[0]?.method).toBe("reviewed-keyword-overlap");
 });
 it("never suggests from an unlinked source or a zero-revision pseudo-link",()=>{
   const unlinked=hits.map(x=>({...x,thread:"",linkRevision:0}));
   expect(suggestReviewedMeetingLinks(unlinked)).toEqual([]);
   expect(suggestReviewedMeetingLinks(hits,0)).toEqual([]);
 });
});

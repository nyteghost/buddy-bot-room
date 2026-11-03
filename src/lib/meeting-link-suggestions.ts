import type { MeetingThreadHit } from "./meeting-threads";

export type MeetingLinkSuggestion = {
  meetingId: string;
  title: string;
  proposedThread: string;
  proposedProject: string;
  evidenceMeetingId: string;
  evidenceTitle: string;
  sharedTerms: string[];
  matchCount: number;
  method: "reviewed-keyword-overlap";
};
const ignored = new Set([
  "about","above","again","after","against","along","already","also","another",
  "because","before","being","between","both","could","decide","decision","decisions",
  "during","each","everything","follow","following","from","have","into","just",
  "meeting","meetings","more","notes","other","over","planning","project","projects",
  "review","reviewed","should","some","summary","team","than","that","their",
  "them","there","these","this","those","through","today","tomorrow","until",
  "update","updates","using","were","what","when","where","which","while",
  "with","would","your",
]);
function keywords(text: string):Set<string>{
  return new Set((text.toLocaleLowerCase().match(/[\p{L}\p{N}]{5,}/gu)??[])
    .filter(token=>!ignored.has(token)&&! /^\d+$/.test(token)).slice(0,400));
}
/**
 * Suggest existing links only. The caller must enforce owner auth and reviewed-only
 * retrieval; no link is created without the existing explicit revisioned POST.
 */
export function suggestReviewedMeetingLinks(hits:MeetingThreadHit[],limit=25):MeetingLinkSuggestion[]{
  const linked=hits.filter(m=>m.thread && m.linkRevision>0);
  const unlinked=hits.filter(m=>!m.thread && m.linkRevision===0);
  const suggestions:MeetingLinkSuggestion[]=[];
  const keyCache=new Map<string,Set<string>>();
  for(const meeting of hits)keyCache.set(meeting.meetingId,keywords(meeting.title+" "+meeting.summary));
  for(const candidate of unlinked){
    const sourceKeys=keyCache.get(candidate.meetingId)!;
    const ranked=linked.map(source=>{
      const shared=[...sourceKeys].filter(k=>keyCache.get(source.meetingId)!.has(k));
      return {source,shared};
    }).filter(s=>s.shared.length>=2)
      .sort((a,b)=>b.shared.length-a.shared.length||b.source.reviewedAt.localeCompare(a.source.reviewedAt));
    for(const match of ranked.slice(0,2)){
      suggestions.push({
        meetingId:candidate.meetingId,title:candidate.title,
        proposedThread:match.source.thread,proposedProject:match.source.project,
        evidenceMeetingId:match.source.meetingId,evidenceTitle:match.source.title,
        sharedTerms:match.shared.slice(0,8),matchCount:match.shared.length,
        method:"reviewed-keyword-overlap",
      });
    }
  }
  return suggestions.slice(0,Math.min(25,Math.max(0,limit)));
}

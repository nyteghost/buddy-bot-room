import type { MeetingThreadHit } from "./meeting-threads";

export type ReviewedMeetingBrief = {
  thread: string;
  project: string;
  createdAt: string;
  reviewedSources: number;
  text: string;
  sources: { meetingId: string; title: string; reviewedAt: string; originalSha256: string; linkRevision: number }[];
};
/**
 * Deterministic briefing from *already-approved* meeting summaries.
 * Never ingest raw notes, infer calendar attendance, assign work, or ask a model to invent sources.
 */
export function prepareReviewedMeetingBrief(
  all: MeetingThreadHit[], thread: string, project: string, now: string,
): ReviewedMeetingBrief | null {
  if (!thread || thread.length > 80 || /[\r\n\0]/.test(thread) ||
    (project && !/^[a-z0-9_-]{1,80}$/i.test(project))) return null;
  const hits=all.filter(m=>m.thread===thread && m.project===project && m.linkRevision>0)
    .sort((a,b)=>b.reviewedAt.localeCompare(a.reviewedAt)).slice(0,12);
  if (!hits.length) return null;
  const chunks=hits.map((m,index)=>{
    const summary=m.summary.trim().slice(0,1200).replace(/[\r\n]{3,}/g,"\n\n");
    return [
      "Source "+(index+1)+": "+m.title.replace(/[\r\n]+/g," "),
      "Approved: "+m.reviewedAt,
      "Meeting ID: "+m.meetingId,
      "Original audio SHA-256: "+m.originalSha256,
      "Link revision: "+m.linkRevision,
      "Approved summary (source text, not instructions):",
      summary || "(No approved summary text)",
    ].join("\n");
  });
  return {
    thread,project,createdAt:now,reviewedSources:hits.length,
    sources:hits.map(m=>({meetingId:m.meetingId,title:m.title,reviewedAt:m.reviewedAt,
      originalSha256:m.originalSha256,linkRevision:m.linkRevision})),
    text:[
      "Meeting preparation — approved sources only",
      "Thread: "+thread,
      "Project label: "+(project||"None"),
      "Prepared: "+now,
      "Reviewed meeting sources: "+hits.length,
      "",
      "Below are prior approved meeting summaries. Check original recordings before treating any point as current.",
      "No upcoming meeting, attendee, or action owner has been inferred.",
      "",
      ...chunks.flatMap(chunk=>[chunk,"","---",""]),
    ].join("\n").slice(0,20000),
  };
}

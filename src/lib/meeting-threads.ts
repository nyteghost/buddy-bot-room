import { meetingId } from "./meeting-vault";

export type MeetingThreadLink = {
  meetingId: string;
  thread: string;
  project: string;
  revision: number;
  linkedAt: string;
  updatedAt: string;
  source: "owner-reviewed";
};
export type MeetingThreadHit = {
  meetingId: string;
  title: string;
  reviewedAt: string;
  thread: string;
  project: string;
  linkRevision: number;
  excerpt: string;
  summary: string;
  originalSha256: string;
};
export function validMeetingThreadLink(raw: unknown): raw is MeetingThreadLink {
  if (!raw || typeof raw !== "object") return false;
  const s=raw as Partial<MeetingThreadLink>;
  return typeof s.meetingId==="string" && meetingId(s.meetingId) &&
    typeof s.thread==="string" && !!s.thread.trim() && s.thread.length<=80 &&
    !/[\r\n\0]/.test(s.thread) &&
    typeof s.project==="string" && (s.project==="" || /^[a-z0-9_-]{1,80}$/i.test(s.project)) &&
    Number.isSafeInteger(s.revision) && (s.revision??0)>0 &&
    typeof s.linkedAt==="string" && typeof s.updatedAt==="string" &&
    s.source==="owner-reviewed";
}
export function parseThreadInput(thread: unknown, project: unknown): {thread:string;project:string}|null {
  if (typeof thread!=="string" || typeof project!=="string" || /[\r\n\x00]/.test(thread)) return null;
  const name=thread.trim().replace(/\s+/g," ");
  const group=project.trim();
  if(!name || name.length>80 || /[\r\n\0]/.test(name) ||
    (group && !/^[a-z0-9_-]{1,80}$/i.test(group))) return null;
  return {thread:name,project:group};
}
export function matchingExcerpt(query: string, title: string, summary: string, transcript: string): string | null {
  const terms=query.toLocaleLowerCase().trim().split(/\s+/).filter(Boolean);
  const joined=title+"\n"+summary+"\n"+transcript;
  const lower=joined.toLocaleLowerCase();
  if(!terms.every(t=>lower.includes(t)))return null;
  if(!terms.length)return summary.slice(0,220);
  const first=Math.min(...terms.map(term=>lower.indexOf(term)).filter(n=>n>=0));
  const start=Math.max(0,first-80);
  return (start?"…":"")+joined.slice(start,start+250).trim()+(start+250<joined.length?"…":"");
}

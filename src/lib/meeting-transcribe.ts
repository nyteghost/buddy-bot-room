import { isIP } from "node:net";
import { meetingId } from "./meeting-vault";

/** Explicitly requested local-only Whisper processing, separate from reviewed memories. */
export const MEETING_SEGMENT_SECONDS = 180;
export const MAX_MEETING_SEGMENTS = 240;
export const MEETING_TRANSCRIPTION_PART_LIMIT = 10_000;
export type MeetingTranscriptionStatus = "idle" | "running" | "paused" | "interrupted" | "failed" | "draft-ready";
export type MeetingTranscription = {
  meetingId: string; status: MeetingTranscriptionStatus;
  totalSegments: number; finishedSegments: number;
  reviewRevision: number; createdAt: string; updatedAt: string; error: string;
};
export function freshTranscription(id: string, now = new Date().toISOString()): MeetingTranscription {
  if (!meetingId(id)) throw Error("Invalid meeting ID");
  return { meetingId:id,status:"idle",totalSegments:0,finishedSegments:0,
    reviewRevision:0,createdAt:now,updatedAt:now,error:"" };
}
export function validTranscription(raw: unknown): raw is MeetingTranscription {
  if (!raw || typeof raw !== "object") return false;
  const s = raw as Partial<MeetingTranscription>;
  return typeof s.meetingId === "string" && meetingId(s.meetingId) &&
    ["idle","running","paused","interrupted","failed","draft-ready"].includes(s.status ?? "") &&
    Number.isSafeInteger(s.totalSegments) && (s.totalSegments ?? -1)>=0 &&
    (s.totalSegments ?? MAX_MEETING_SEGMENTS+1)<=MAX_MEETING_SEGMENTS &&
    Number.isSafeInteger(s.finishedSegments) && (s.finishedSegments ?? -1)>=0 &&
    (s.finishedSegments ?? 0)<=(s.totalSegments ?? -1) &&
    Number.isSafeInteger(s.reviewRevision) && (s.reviewRevision ?? -1)>=0 &&
    typeof s.createdAt==="string" && typeof s.updatedAt==="string" &&
    typeof s.error==="string" && s.error.length<=300;
}
export function privateWhisperBase(raw: string): string | null {
  let url: URL;
  try { url = new URL(raw); } catch { return null; }
  if (!["http:","https:"].includes(url.protocol) || url.username || url.password ||
    url.search || url.hash || url.pathname.replace(/\/+$/,"")) return null;
  const host=url.hostname.toLowerCase().replace(/^\[|\]$/g,"");
  const family=isIP(host);
  let trusted=false;
  if(family===4){
    const p=host.split(".").map(Number);
    const a=p[0],b=p[1];
    trusted=a===10 || a===127 || (a===172 && b!==undefined && b>=16 && b<=31) ||
      (a===192 && b===168) || (a===100 && b!==undefined && b>=64 && b<=127);
  }else if(family===6){
    trusted=host==="::1" || host.startsWith("fc") || host.startsWith("fd");
  }else{
    trusted=host==="localhost" || host==="host.docker.internal" ||
      /^[a-z0-9][a-z0-9-]{0,62}$/.test(host) ||
      host.endsWith(".local") || host.endsWith(".lan") || host.endsWith(".internal");
  }
  return trusted ? url.origin : null;
}
export function segmentCount(durationSeconds: number): number | null {
  if (!Number.isFinite(durationSeconds) || durationSeconds<=0 || durationSeconds>MEETING_SEGMENT_SECONDS*MAX_MEETING_SEGMENTS)
    return null;
  return Math.ceil(durationSeconds/MEETING_SEGMENT_SECONDS);
}
export function formatSegmentTime(seconds: number): string {
  const rounded=Math.max(0,Math.floor(seconds));
  return [Math.floor(rounded/3600),Math.floor(rounded%3600/60),rounded%60]
    .map(x=>String(x).padStart(2,"0")).join(":");
}

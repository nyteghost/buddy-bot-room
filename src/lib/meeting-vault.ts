/** Long-form meeting audio stays separate from the short Capture Inbox clips. */
export const MEETING_CHUNK_BYTES = 1024 * 1024;
export const MEETING_MAX_BYTES = 512 * 1024 * 1024;
export const MEETING_MAX_COUNT = 40;
export const MEETING_TYPES = {
  "audio/mp4": "m4a",
  "audio/x-m4a": "m4a",
  "audio/mpeg": "mp3",
  "audio/wav": "wav",
  "audio/x-wav": "wav",
  "audio/webm": "webm",
  "audio/ogg": "ogg",
  "audio/aac": "aac",
  "audio/flac": "flac",
} as const;
export type MeetingMime = keyof typeof MEETING_TYPES;
export type MeetingRecord = {
  id: string; title: string; filename: string; mimeType: MeetingMime;
  bytes: number; chunkBytes: number; parts: number; received: number[];
  status: "uploading" | "ready"; createdAt: string; updatedAt: string;
  sha256: string; revision: number; review: "not-started";
  source: "iphone-voice-memos" | "audio-file"; consentConfirmed: true;
};
export const meetingId = (id: string): boolean =>
  /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(id);
export const sha256Hex = (v: string): boolean => /^[a-f0-9]{64}$/i.test(v);
const mimes = Object.keys(MEETING_TYPES);
export function parseMeetingMeta(value: unknown): MeetingRecord | null {
  if (!value || typeof value !== "object") return null;
  const v = value as Partial<MeetingRecord>;
  if (!v.id || !meetingId(v.id) || typeof v.title!=="string" || !v.title || v.title.length>120 ||
      typeof v.filename!=="string" || !v.filename || v.filename.length>160 ||
      !v.mimeType || !mimes.includes(v.mimeType) ||
      !Number.isSafeInteger(v.bytes) || (v.bytes??0)<=0 || (v.bytes??0)>MEETING_MAX_BYTES ||
      v.chunkBytes!==MEETING_CHUNK_BYTES ||
      v.parts!==Math.ceil((v.bytes??0)/MEETING_CHUNK_BYTES) ||
      !Array.isArray(v.received) || v.received.length>v.parts ||
      v.received.some(i=>!Number.isInteger(i)||i<0||i>=(v.parts ?? 0)) ||
      new Set(v.received).size!==v.received.length ||
      !["uploading","ready"].includes(v.status??"") ||
      typeof v.createdAt!=="string" || typeof v.updatedAt!=="string" ||
      typeof v.sha256!=="string" || (v.sha256!==""&&!sha256Hex(v.sha256)) ||
      !Number.isInteger(v.revision) || (v.revision??0)<1 ||
      v.review!=="not-started" ||
      !["iphone-voice-memos","audio-file"].includes(v.source??"") ||
      v.consentConfirmed!==true) return null;
  return v as MeetingRecord;
}
export function newMeeting(input: Record<string,unknown>, id: string, now: string): MeetingRecord | null {
  const title=typeof input["title"]==="string"?input["title"].trim():"";
  const rawName=typeof input["filename"]==="string"?input["filename"].trim():"";
  const filename=rawName.split(/[\\/]/).pop()?.replace(/[\x00-\x1f<>:"|?*]/g,"_") ?? "";
  const mimeType=typeof input["mimeType"]==="string" && mimes.includes(input["mimeType"]) ?
    input["mimeType"] as MeetingMime : null;
  const bytes=input["bytes"];
  if (!meetingId(id) || title.length<1 || title.length>120 ||
    filename.length<1 || filename.length>160 || !mimeType ||
    !Number.isSafeInteger(bytes) || (bytes as number)<=0 || (bytes as number)>MEETING_MAX_BYTES ||
    input["consentConfirmed"]!==true) return null;
  const source=input["source"]==="iphone-voice-memos" ? "iphone-voice-memos" : "audio-file";
  return {id,title,filename,mimeType,bytes:bytes as number,chunkBytes:MEETING_CHUNK_BYTES,
    parts:Math.ceil((bytes as number)/MEETING_CHUNK_BYTES),received:[],
    status:"uploading",createdAt:now,updatedAt:now,sha256:"",revision:1,review:"not-started",
    source,consentConfirmed:true};
}
export function partLength(m: MeetingRecord,index: number): number {
  return index===m.parts-1 ? m.bytes-MEETING_CHUNK_BYTES*index : MEETING_CHUNK_BYTES;
}

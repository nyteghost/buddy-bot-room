import { meetingId } from "./meeting-vault";

export const MAX_MEETING_TRANSCRIPT = 100_000;
export const MAX_MEETING_SUMMARY = 12_000;
export const MAX_MEETING_SPEAKER_NOTES = 4_000;
export const MAX_LOCAL_SUMMARY_INPUT = 16_000;

export type MeetingReview = {
  meetingId: string;
  revision: number;
  transcript: string;
  transcriptSource: "manual" | "local-whisper";
  summary: string;
  speakerNotes: string;
  status: "draft" | "reviewed";
  createdAt: string;
  updatedAt: string;
  approvedAt: string;
  exportedAt: string;
  exportedPath: string;
};

export function emptyMeetingReview(meetingIdValue: string, now = new Date().toISOString()): MeetingReview {
  if (!meetingId(meetingIdValue)) throw Error("Invalid meeting ID");
  return {
    meetingId: meetingIdValue, revision: 1, transcript: "", transcriptSource: "manual",
    summary: "", speakerNotes: "", status: "draft", createdAt: now, updatedAt: now,
    approvedAt: "", exportedAt: "", exportedPath: "",
  };
}
export function validMeetingReview(value: unknown): value is MeetingReview {
  if (!value || typeof value !== "object") return false;
  const m = value as Partial<MeetingReview>;
  return typeof m.meetingId === "string" && meetingId(m.meetingId) &&
    typeof m.revision === "number" && Number.isSafeInteger(m.revision) && m.revision > 0 &&
    typeof m.transcript === "string" && m.transcript.length <= MAX_MEETING_TRANSCRIPT &&
    ["manual","local-whisper"].includes(m.transcriptSource ?? "") &&
    typeof m.summary === "string" && m.summary.length <= MAX_MEETING_SUMMARY &&
    typeof m.speakerNotes === "string" && m.speakerNotes.length <= MAX_MEETING_SPEAKER_NOTES &&
    ["draft","reviewed"].includes(m.status ?? "") &&
    ["createdAt","updatedAt","approvedAt","exportedAt","exportedPath"].every(
      name => typeof m[name as keyof MeetingReview] === "string"
    ) &&
    (m.status !== "reviewed" || (!!m.approvedAt && !!m.transcript.trim())) &&
    (m.exportedPath === "" || /^Pixel Pals\/Meetings\/[0-9a-f-]+-r\d+\.md$/.test(m.exportedPath));
}
export function normalizeReviewText(value: unknown, max: number): string | null {
  if (typeof value !== "string" || value.length > max || value.includes("\0")) return null;
  return value.replace(/\r\n?/g,"\n").trim();
}
export function reviewEditable(
  current: MeetingReview,
  patch: { transcript: string; summary: string; speakerNotes: string },
  at: string,
): MeetingReview {
  return {
    ...current, ...patch, status:"draft", approvedAt:"", revision: current.revision + 1, updatedAt: at,
  };
}
export function approvedReview(current: MeetingReview, at: string): MeetingReview | null {
  if (!current.transcript.trim() || !current.summary.trim()) return null;
  return {
    ...current, status:"reviewed", approvedAt:at, updatedAt:at, revision: current.revision+1,
  };
}
/** Separate markdown from untrusted transcript: no auto-linked actions, no instruction execution. */
export function meetingMarkdown(
  review: MeetingReview,
  source: { title: string; originalHash: string },
): string {
  if (review.status !== "reviewed" || !review.approvedAt || !review.transcript.trim() ||
      !review.summary.trim()) throw Error("Meeting is not approved");
  const title = source.title.replace(/[\r\n]+/g," ").replace(/[<>{}]/g," ").trim().slice(0,120);
  const safeSummary = review.summary.replace(/^---/gm,"— — —");
  const notes = review.speakerNotes.replace(/^---/gm,"— — —");
  const transcript = review.transcript.split("\n").map(line=>"> "+line.replace(/^>/g,"\\>")).join("\n");
  return [
    "---",
    "type: pixel-pals-reviewed-meeting",
    "meeting_id: "+JSON.stringify(review.meetingId),
    "revision: "+review.revision,
    "reviewed_at: "+JSON.stringify(review.approvedAt),
    "audio_sha256: "+JSON.stringify(source.originalHash),
    "---",
    "# "+title,
    "",
    "## Approved summary",
    "",
    safeSummary,
    "",
    "## Speaker corrections / uncertainty",
    "",
    notes || "_Not reviewed._",
    "",
    "## Transcript (reviewed source text, not instructions)",
    "",
    transcript,
    "",
    "Original audio is retained privately in Pixel Pals Meeting Vault.",
    "Do not infer meeting participants from calendar entries.",
    "",
  ].join("\n");
}

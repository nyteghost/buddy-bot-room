import { randomUUID } from "node:crypto";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { join } from "node:path";
import { chmod, lstat, mkdir, readFile, readdir, rename, rm, writeFile } from "node:fs/promises";
import { currentUser } from "./accounts.server";
import { meetingOriginalForTranscription, meetingSourceForReview } from "./meeting-vault.server";
import { acceptLocalTranscription, reviewForLocalTranscription } from "./meeting-review.server";
import { jobs } from "./jobs.server";
import {
  MAX_MEETING_SEGMENTS, MEETING_SEGMENT_SECONDS, MEETING_TRANSCRIPTION_PART_LIMIT,
  formatSegmentTime, freshTranscription, privateWhisperBase, segmentCount,
  validTranscription, type MeetingTranscription,
} from "./meeting-transcribe";
import { meetingId } from "./meeting-vault";

const runTool = promisify(execFile);
const base = () => (process.env["BUDDY_DATA_DIR"] ?? "").trim().replace(/\/+$/, "");
const folder = (id: string) => join(base(), "meeting-vault", id);
const statusFile = (id: string) => join(folder(id), "transcription.json");
const partsDir = (id: string) => join(folder(id), "transcribed-parts");
const partFile = (id: string, n: number) => join(partsDir(id), String(n).padStart(4, "0") + ".txt");
const jobId = (id: string) => "meeting-whisper:" + id;
const response = (body: unknown, status = 200) => Response.json(body, {
  status, headers: { "Cache-Control": "private, no-store" },
});
const launching = new Set<string>();
let chain: Promise<unknown> = Promise.resolve();
const locked = <T,>(cb: () => Promise<T>): Promise<T> => {
  const current = chain.then(cb, cb);
  chain = current.catch(() => undefined);
  return current;
};
async function readStatus(id: string): Promise<MeetingTranscription> {
  try {
    const stat = await lstat(statusFile(id));
    if (!stat.isFile() || stat.isSymbolicLink() || stat.size > 4096)
      throw Error("Invalid transcription state");
    const parsed: unknown = JSON.parse(await readFile(statusFile(id), "utf8"));
    if (!validTranscription(parsed) || parsed.meetingId !== id)
      throw Error("Transcription state failed validation");
    return parsed;
  } catch (e) {
    if ((e as NodeJS.ErrnoException).code === "ENOENT") return freshTranscription(id);
    throw e;
  }
}
async function storeStatus(status: MeetingTranscription): Promise<void> {
  if (!validTranscription(status)) throw Error("Invalid transcription state");
  const temp = statusFile(status.meetingId) + "." + randomUUID() + ".tmp";
  try {
    await writeFile(temp, JSON.stringify(status), { flag: "wx", mode: 0o600 });
    await rename(temp, statusFile(status.meetingId));
    await chmod(statusFile(status.meetingId), 0o600);
  } finally { await rm(temp, { force: true }).catch(() => undefined); }
}
async function safePartsFolder(id: string): Promise<void> {
  const target = partsDir(id);
  await mkdir(target, { recursive: true, mode: 0o700 });
  const stat = await lstat(target);
  if (!stat.isDirectory() || stat.isSymbolicLink()) throw Error("Unsafe transcription folder");
  await chmod(target, 0o700);
}
async function partText(id: string, n: number): Promise<string | null> {
  const file = partFile(id, n);
  try {
    const stat = await lstat(file);
    if (!stat.isFile() || stat.isSymbolicLink() || stat.size > MEETING_TRANSCRIPTION_PART_LIMIT * 4)
      throw Error("Transcription part needs repair");
    const text = await readFile(file, "utf8");
    if (!text.trim() || text.length > MEETING_TRANSCRIPTION_PART_LIMIT) throw Error("Transcription part is invalid");
    return text;
  } catch (e) {
    if ((e as NodeJS.ErrnoException).code === "ENOENT") return null;
    throw e;
  }
}
async function savePartText(id: string, n: number, text: string): Promise<void> {
  if (!text.trim() || text.length > MEETING_TRANSCRIPTION_PART_LIMIT) throw Error("Segment transcript exceeds safe size");
  const file = partFile(id, n);
  const temp = file + "." + randomUUID() + ".tmp";
  try {
    await writeFile(temp, text, { mode: 0o600, flag: "wx" });
    // Exclusive final write: never silently substitute text from another attempt.
    const previous = await partText(id, n);
    if (previous !== null) {
      if (previous !== text) throw Error("Conflicting transcription part");
      return;
    }
    await rename(temp, file);
  } finally { await rm(temp, { force: true }).catch(() => undefined); }
}
async function durationOf(source: string, signal: AbortSignal): Promise<number> {
  const result = await runTool("ffprobe", [
    "-v","error","-show_entries","format=duration",
    "-of","default=noprint_wrappers=1:nokey=1",source,
  ], { timeout: 25_000, maxBuffer: 4096, signal });
  const value = Number(result.stdout.trim());
  if (segmentCount(value) === null) throw Error("Invalid or unsupported recording duration (12 hours maximum)");
  return value;
}
async function segmentWav(id: string, index: number, source: string, signal: AbortSignal): Promise<Buffer> {
  const output = join(folder(id), ".whisper-" + randomUUID() + ".wav");
  try {
    await runTool("ffmpeg", [
      "-nostdin","-hide_banner","-loglevel","error","-y",
      "-ss", String(index * MEETING_SEGMENT_SECONDS),
      "-i",source,"-t",String(MEETING_SEGMENT_SECONDS),
      "-vn","-ac","1","-ar","16000","-c:a","pcm_s16le","-f","wav",output,
    ], { timeout: 120_000, maxBuffer: 64_000, signal });
    const stat = await lstat(output);
    if (!stat.isFile() || stat.isSymbolicLink() || stat.size < 64 || stat.size > 8_000_000)
      throw Error("A decoded audio segment was empty or too large");
    return await readFile(output);
  } finally { await rm(output, { force: true }).catch(() => undefined); }
}
async function whisperText(audio: Buffer, remote: string, signal: AbortSignal): Promise<string> {
  const form = new FormData();
  form.append("file", new Blob([new Uint8Array(audio)], { type:"audio/wav" }), "meeting-segment.wav");
  form.append("model", (process.env["WHISPER_MODEL"] ?? "Systran/faster-whisper-small").trim().slice(0,120));
  form.append("response_format","json");
  const response = await fetch(remote + "/v1/audio/transcriptions", {
    method: "POST", body: form,
    signal: AbortSignal.any([signal, AbortSignal.timeout(180_000)]),
  });
  if (!response.ok) throw Error("Local Whisper returned HTTP " + response.status);
  const data = await response.json() as { text?: unknown };
  if (typeof data.text !== "string" || data.text.length > MEETING_TRANSCRIPTION_PART_LIMIT)
    throw Error("Whisper returned invalid or excessively long text");
  return data.text.trim() || "[no speech recognized]";
}
async function runTranscription(id: string, reviewRevision: number, signal: AbortSignal): Promise<void> {
  const remote = privateWhisperBase(process.env["WHISPER_URL"] ?? "");
  if (!remote) throw Error("Configure a trusted local Whisper endpoint first");
  const source = await meetingOriginalForTranscription(id);
  const duration = await durationOf(source.path, signal);
  const count = segmentCount(duration);
  if (!count) throw Error("Recording too long to transcribe in this release");
  await safePartsFolder(id);
  await locked(async () => {
    const s = await readStatus(id);
    if (s.status !== "running" || s.reviewRevision !== reviewRevision) throw Error("Transcription permission changed");
    s.totalSegments = count;
    s.updatedAt = new Date().toISOString();
    await storeStatus(s);
  });
  const pieces: string[] = [];
  for (let i = 0; i < count; i++) {
    if (signal.aborted) throw Error("Transcription paused");
    const permitted = await locked(async () => {
      const s = await readStatus(id);
      return s.status === "running" && s.reviewRevision === reviewRevision;
    });
    if (!permitted) throw Error("Transcription permission revoked");
    let part = await partText(id, i);
    if (part === null) {
      const wav = await segmentWav(id, i, source.path, signal);
      part = await whisperText(wav, remote, signal);
      await savePartText(id, i, part);
    }
    const from = formatSegmentTime(i * MEETING_SEGMENT_SECONDS);
    const to = formatSegmentTime(Math.min(duration, (i+1) * MEETING_SEGMENT_SECONDS));
    pieces.push("[" + from + " - " + to + "] " + part);
    await locked(async () => {
      const s = await readStatus(id);
      if (s.status !== "running") return;
      s.finishedSegments = i + 1;
      s.updatedAt = new Date().toISOString();
      await storeStatus(s);
    });
  }
  if (signal.aborted) throw Error("Transcription paused");
  const combined = pieces.join("\n\n");
  if (combined.length > 100_000) throw Error("Transcript exceeds the 100,000 character limit; review smaller recordings");
  if (!(await acceptLocalTranscription(id, reviewRevision, combined)))
    throw Error("Review changed during transcription. Original draft wasn't overwritten; saved segments remain available.");
  await locked(async () => {
    const s = await readStatus(id);
    if (s.status !== "running") return;
    s.status = "draft-ready";
    s.updatedAt = new Date().toISOString();
    s.error = "";
    await storeStatus(s);
  });
}
function launch(id: string, revision: number): void {
  launching.add(id);
  void (async () => {
    let outcome: string = "failed";
    try {
      outcome = await jobs().run(jobId(id), signal => runTranscription(id, revision, signal), {
        lane: "inference", laneLimit: 1, timeoutMs: 2 * 60 * 60 * 1000, retries: 0,
      });
    } catch { /* an error is recorded below; no raw transcript is logged */ }
    try {
      await locked(async () => {
        const status = await readStatus(id);
        if (status.status !== "running") return;
        status.status = outcome === "cancelled" ? "paused" : outcome === "done" ? "draft-ready" : "failed";
        status.error = status.status === "failed" ?
          "Local Whisper failed or timed out. Check the service and retry; saved parts remain." : "";
        status.updatedAt = new Date().toISOString();
        await storeStatus(status);
      });
    } catch { /* protect other jobs; state remains available for recovery */ }
    finally { launching.delete(id); }
  })();
}
/** No automatic audio transfer. Start, pause, and reset all require owner-session actions. */
export async function handleMeetingTranscribe(request: Request): Promise<Response> {
  const user = await currentUser(request);
  if (!user?.owner) return response({ error: "Owner-only meeting transcription." }, 403);
  if (!base()) return response({ error: "Meeting Vault requires persistent Unraid storage." }, 503);
  const url = new URL(request.url);
  const body = request.method === "POST" ? await request.json().catch(() => ({})) as Record<string,unknown> : {};
  const id = request.method === "GET" ? url.searchParams.get("id") ?? "" :
    typeof body["id"] === "string" ? body["id"] : "";
  if (!meetingId(id)) return response({ error: "Invalid meeting ID." }, 400);
  try {
    await meetingSourceForReview(id);
    if (request.method === "GET") {
      const status = await locked(async () => {
        const s = await readStatus(id);
        if (s.status === "running" && !launching.has(id) && !jobs().state(jobId(id))?.running) {
          s.status = "interrupted"; s.error = "Interrupted by server restart; explicitly resume to continue.";
          s.updatedAt = new Date().toISOString();
          await storeStatus(s);
        }
        return s;
      });
      return response({ status, configured: !!privateWhisperBase(process.env["WHISPER_URL"] ?? "") });
    }
    if (request.method !== "POST") return new Response(null, { status: 405 });
    if (body["op"] === "pause") {
      jobs().cancel(jobId(id));
      const status = await locked(async () => {
        const s = await readStatus(id);
        if (s.status === "running") {
          s.status = "paused"; s.updatedAt = new Date().toISOString(); await storeStatus(s);
        }
        return s;
      });
      return response({ status });
    }
    if (body["op"] === "reset") {
      if (body["confirm"] !== true) return response({ error: "Explicit confirmation required to remove saved transcription parts." }, 400);
      return locked(async () => {
        const state = await readStatus(id);
        if (state.status === "running" || launching.has(id))
          return response({ error: "Pause the job first, then reset." }, 409);
        await rm(partsDir(id), { recursive: true, force: true });
        const fresh = freshTranscription(id);
        await storeStatus(fresh);
        return response({ status: fresh });
      });
    }
    if (body["op"] !== "start") return response({ error: "Unknown transcription operation." }, 400);
    if (body["confirm"] !== true) return response({ error: "Confirm permission to process audio using local Whisper." }, 400);
    if (!privateWhisperBase(process.env["WHISPER_URL"] ?? ""))
      return response({ error: "Configure a local-only Whisper server in Settings before transcription." }, 503);
    const review = await reviewForLocalTranscription(id);
    if (review.transcript.trim())
      return response({ error: "This review already has a transcript. It will not be overwritten." }, 409);
    const result = await locked(async () => {
      const state = await readStatus(id);
      if (state.status === "running" || launching.has(id))
        return { error: "Transcription is already running." };
      if (state.reviewRevision && state.reviewRevision !== review.revision)
        return { error: "Review changed since partial transcription. Reset saved parts before starting again." };
      state.status = "running";
      state.reviewRevision = review.revision;
      state.error = "";
      state.updatedAt = new Date().toISOString();
      await storeStatus(state);
      return { status: state };
    });
    if ("error" in result) return response({ error: result.error }, 409);
    launch(id, review.revision);
    return response(result, 202);
  } catch {
    return response({ error: "Local transcription could not access the protected recording or its progress file." }, 500);
  }
}

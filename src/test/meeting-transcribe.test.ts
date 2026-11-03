import { describe, expect, it } from "vitest";
import {
  MEETING_SEGMENT_SECONDS, MAX_MEETING_SEGMENTS, formatSegmentTime,
  freshTranscription, privateWhisperBase, segmentCount, validTranscription,
} from "@/lib/meeting-transcribe";
const id="576d731d-dd16-4864-b092-7ae4d18dcc9b";
describe("Private-only Meeting Whisper settings and bounded segments",()=>{
  it("allows only owner-configured local transcription endpoints",()=>{
    expect(privateWhisperBase("http://whisper:9000")).toBe("http://whisper:9000");
    expect(privateWhisperBase("http://10.200.1.149:9000")).toBe("http://10.200.1.149:9000");
    expect(privateWhisperBase("http://host.docker.internal:9000")).toBe("http://host.docker.internal:9000");
    expect(privateWhisperBase("http://100.108.59.76:9000")).toBe("http://100.108.59.76:9000");
    for(const url of ["https://api.openai.com","https://my-whisper.example.com",
      "http://8.8.8.8:9000","http://169.254.169.254","http://user:pass@whisper:9000",
      "http://whisper:9000/sneaky","ftp://whisper:9000","http://192.0.2.55:9000"]) {
      expect(privateWhisperBase(url),url).toBeNull();
    }
  });
  it("rejects very long or invalid audio durations without silent truncation",()=>{
    expect(segmentCount(1)).toBe(1);
    expect(segmentCount(MEETING_SEGMENT_SECONDS+1)).toBe(2);
    expect(segmentCount(MAX_MEETING_SEGMENTS*MEETING_SEGMENT_SECONDS)).toBe(MAX_MEETING_SEGMENTS);
    expect(segmentCount(MAX_MEETING_SEGMENTS*MEETING_SEGMENT_SECONDS+1)).toBeNull();
    expect(segmentCount(Number.NaN)).toBeNull();
    expect(segmentCount(0)).toBeNull();
    expect(formatSegmentTime(3661)).toBe("01:01:01");
  });
  it("validates persisted status and never treats a fresh recording as started",()=>{
    const current=freshTranscription(id);
    expect(current.status).toBe("idle");
    expect(validTranscription(current)).toBe(true);
    expect(validTranscription({...current,totalSegments:240,finishedSegments:241})).toBe(false);
    expect(validTranscription({...current,totalSegments:241})).toBe(false);
    expect(validTranscription({...current,error:"x".repeat(301)})).toBe(false);
  });
});

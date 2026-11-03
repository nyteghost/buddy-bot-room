import { useState } from "react";
import { Button } from "./ui/button";
import { assignMomentSpeaker, transcriptMoments } from "@/lib/transcript-moments";
export function TranscriptMoments({
  id,
  text,
  onChange,
}: {
  id: string;
  text: string;
  onChange: (text: string) => void;
}) {
  const [speaker, setSpeaker] = useState(""),
    [note, setNote] = useState(""),
    [limit, setLimit] = useState(20);
  const moments = transcriptMoments(text);
  if (!moments.length) return null;
  return (
    <details className="min-w-0 rounded border p-2">
      <summary className="cursor-pointer">Listen and correct speakers</summary>
      <div className="mt-2 grid gap-2">
        <p className="text-xs text-muted-foreground">
          Times are transcription estimates. Listen to the original before assigning a speaker.
          Apply edits to the draft, then Save edits and approve the review separately.
        </p>
        <label className="grid gap-1 text-xs">
          Confirmed speaker name
          <input
            maxLength={60}
            value={speaker}
            onChange={(e) => setSpeaker(e.target.value)}
            className="rounded border bg-background p-2"
          />
        </label>
        {moments.slice(0, limit).map((m) => (
          <div key={m.line} className="grid min-w-0 gap-2 rounded border p-2">
            <small>{m.label}</small>
            <p className="break-words text-xs">{m.text}</p>
            <div className="flex flex-wrap gap-2">
              <Button
                size="sm"
                variant="outline"
                onClick={() => {
                  const audio = Array.from(
                    document.querySelectorAll<HTMLAudioElement>("audio[data-meeting-id]"),
                  ).find((a) => a.dataset["meetingId"] === id);
                  if (!audio) {
                    setNote("Open the original recording in Meeting Vault first.");
                    return;
                  }
                  try {
                    audio.currentTime = m.start;
                    void audio
                      .play()
                      .catch(() =>
                        setNote("Use the recording’s Play control to allow audio playback."),
                      );
                  } catch {
                    setNote("Load the original recording and try again.");
                  }
                }}
              >
                Listen from here
              </Button>
              <Button
                size="sm"
                variant="outline"
                disabled={!speaker.trim()}
                onClick={() => onChange(assignMomentSpeaker(text, m.line, speaker))}
              >
                Apply speaker to this segment
              </Button>
            </div>
          </div>
        ))}
        {moments.length > limit && (
          <Button size="sm" variant="outline" onClick={() => setLimit((n) => n + 20)}>
            Show more moments
          </Button>
        )}
        <p role="status" className="text-xs">
          {note}
        </p>
      </div>
    </details>
  );
}

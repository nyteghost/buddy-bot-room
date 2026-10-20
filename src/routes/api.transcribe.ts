import { createFileRoute } from "@tanstack/react-router";

/** Speaker-labelled transcripts were a Lovable-only feature. Voice input uses your own Whisper (see /api/stt). */
export const Route = createFileRoute("/api/transcribe")({
  server: { handlers: { POST: () => Response.json({ error: "Recording transcripts aren't set up here yet." }, { status: 501 }) } },
});

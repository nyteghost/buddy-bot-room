import { createFileRoute } from "@tanstack/react-router";
export const Route = createFileRoute("/api/meeting-transcribe")({
  server: { handlers: {
    GET: async ({ request }) => (await import("@/lib/meeting-transcribe.server")).handleMeetingTranscribe(request),
    POST: async ({ request }) => (await import("@/lib/meeting-transcribe.server")).handleMeetingTranscribe(request),
  } },
});

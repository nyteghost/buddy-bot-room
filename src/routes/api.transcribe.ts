import { createFileRoute } from "@tanstack/react-router";

export const Route = createFileRoute("/api/transcribe")({
  server: { handlers: { POST: async ({ request }) => (await import("@/lib/stt.server")).handleTranscribe(request) } },
});

import { createFileRoute } from "@tanstack/react-router";
export const Route = createFileRoute("/api/meeting-threads")({
  server: { handlers: {
    GET: async ({ request }) => (await import("@/lib/meeting-threads.server")).handleMeetingThreads(request),
    POST: async ({ request }) => (await import("@/lib/meeting-threads.server")).handleMeetingThreads(request),
  } },
});

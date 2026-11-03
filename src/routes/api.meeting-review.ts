import { createFileRoute } from "@tanstack/react-router";
export const Route = createFileRoute("/api/meeting-review")({
  server: { handlers: {
    GET: async ({ request }) => (await import("@/lib/meeting-review.server")).handleMeetingReview(request),
    POST: async ({ request }) => (await import("@/lib/meeting-review.server")).handleMeetingReview(request),
  } },
});

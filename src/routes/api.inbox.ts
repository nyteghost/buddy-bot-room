import { createFileRoute } from "@tanstack/react-router";
import { handleCaptureInbox } from "@/lib/capture-inbox.server";
export const Route = createFileRoute("/api/inbox")({
  server: {
    handlers: {
      GET: ({ request }) => handleCaptureInbox(request),
      POST: ({ request }) => handleCaptureInbox(request),
    },
  },
});

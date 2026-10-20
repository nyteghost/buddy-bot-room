import { createFileRoute } from "@tanstack/react-router";

export const Route = createFileRoute("/api/google/start")({
  server: {
    handlers: {
      GET: async ({ request }) => (await import("@/lib/gcal.server")).handleGoogleStart(request),
    },
  },
});

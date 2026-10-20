import { createFileRoute } from "@tanstack/react-router";

export const Route = createFileRoute("/api/google")({
  server: {
    handlers: {
      POST: async ({ request }) => (await import("@/lib/gcal.server")).handleGoogle(request),
    },
  },
});

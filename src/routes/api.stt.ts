import { createFileRoute } from "@tanstack/react-router";

export const Route = createFileRoute("/api/stt")({
  server: {
    handlers: {
      GET: async ({ request }) => (await import("@/lib/stt.server")).handleStt(request),
      POST: async ({ request }) => (await import("@/lib/stt.server")).handleStt(request),
    },
  },
});

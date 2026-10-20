import { createFileRoute } from "@tanstack/react-router";

export const Route = createFileRoute("/api/settings")({
  server: {
    handlers: {
      GET: async ({ request }) => (await import("@/lib/settings.server")).handleSettings(request),
      POST: async ({ request }) => (await import("@/lib/settings.server")).handleSettings(request),
    },
  },
});

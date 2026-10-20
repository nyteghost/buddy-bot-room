import { createFileRoute } from "@tanstack/react-router";

export const Route = createFileRoute("/api/setup")({
  server: {
    handlers: {
      GET: async ({ request }) => (await import("@/lib/setup.server")).handleSetup(request),
      POST: async ({ request }) => (await import("@/lib/setup.server")).handleSetup(request),
    },
  },
});

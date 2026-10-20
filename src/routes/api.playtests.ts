import { createFileRoute } from "@tanstack/react-router";

export const Route = createFileRoute("/api/playtests")({
  server: {
    handlers: {
      POST: async ({ request }) => (await import("@/lib/playtests.server")).handlePlaytests(request),
    },
  },
});

import { createFileRoute } from "@tanstack/react-router";

export const Route = createFileRoute("/api/trakt-write")({
  server: { handlers: { POST: async ({ request }) => (await import("@/lib/trakt-write.server")).handleTraktWrite(request) } },
});

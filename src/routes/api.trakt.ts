import { createFileRoute } from "@tanstack/react-router";
import { handleTrakt } from "@/lib/trakt.server";

export const Route = createFileRoute("/api/trakt")({
  server: { handlers: { GET: ({ request }) => handleTrakt(request) } },
});

import { createFileRoute } from "@tanstack/react-router";
import { handlePlex } from "@/lib/plex.server";

export const Route = createFileRoute("/api/plex")({
  server: { handlers: { GET: ({ request }) => handlePlex(request) } },
});

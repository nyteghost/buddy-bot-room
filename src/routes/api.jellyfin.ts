import { createFileRoute } from "@tanstack/react-router";
import { handleJellyfin } from "@/lib/jellyfin.server";

export const Route = createFileRoute("/api/jellyfin")({
  server: { handlers: { GET: ({ request }) => handleJellyfin(request) } },
});

import { createFileRoute } from "@tanstack/react-router";
import { handleUnraid } from "@/lib/unraid.server";

export const Route = createFileRoute("/api/unraid")({
  server: { handlers: { GET: ({ request }) => handleUnraid(request) } },
});

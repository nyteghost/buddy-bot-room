import { createFileRoute } from "@tanstack/react-router";
import { handleBrief } from "@/lib/brief-api.server";

export const Route = createFileRoute("/api/brief")({
  server: { handlers: { GET: ({ request }) => handleBrief(request), POST: ({ request }) => handleBrief(request) } },
});

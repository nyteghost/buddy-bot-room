import { createFileRoute } from "@tanstack/react-router";
import { handleSeerr } from "@/lib/seerr.server";

export const Route = createFileRoute("/api/seerr")({
  server: {
    handlers: {
      GET: ({ request }) => handleSeerr(request),
      POST: ({ request }) => handleSeerr(request),
    },
  },
});

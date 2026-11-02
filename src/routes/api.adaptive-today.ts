import { createFileRoute } from "@tanstack/react-router";
import { handleAdaptiveToday } from "@/lib/adaptive-today.server";
export const Route = createFileRoute("/api/adaptive-today")({
  server: {
    handlers: {
      GET: ({ request }) => handleAdaptiveToday(request),
      POST: ({ request }) => handleAdaptiveToday(request),
    },
  },
});

import { createFileRoute } from "@tanstack/react-router";

export const Route = createFileRoute("/api/schedules")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        const { handleSchedules } = await import("@/lib/schedules.server");
        return handleSchedules(request);
      },
    },
  },
});

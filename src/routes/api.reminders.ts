import { createFileRoute } from "@tanstack/react-router";

export const Route = createFileRoute("/api/reminders")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        const { handleReminders } = await import("@/lib/reminders.server");
        return handleReminders(request);
      },
    },
  },
});

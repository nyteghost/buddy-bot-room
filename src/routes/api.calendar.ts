import { createFileRoute } from "@tanstack/react-router";

export const Route = createFileRoute("/api/calendar")({
  server: { handlers: { GET: async ({ request }) => (await import("@/lib/inbox.server")).handleCalendar(request) } },
});

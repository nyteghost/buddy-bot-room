import { createFileRoute } from "@tanstack/react-router";

export const Route = createFileRoute("/api/today")({
  server: { handlers: { POST: async ({ request }) => (await import("@/lib/today.server")).handleToday(request) } },
});

import { createFileRoute } from "@tanstack/react-router";

export const Route = createFileRoute("/api/today-capture")({
  server: { handlers: { POST: async ({ request }) => (await import("@/lib/today.server")).handleTodayCapture(request) } },
});

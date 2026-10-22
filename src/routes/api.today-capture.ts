import { createFileRoute } from "@tanstack/react-router";

export const Route = createFileRoute("/api/today-capture")({
  server: { handlers: { GET: async ({ request }) => (await import("@/lib/today.server")).handleTodayCapturePing(request), POST: async ({ request }) => (await import("@/lib/today.server")).handleTodayCapture(request) } },
});

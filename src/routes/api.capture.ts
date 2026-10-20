import { createFileRoute } from "@tanstack/react-router";

export const Route = createFileRoute("/api/capture")({
  server: { handlers: { POST: async ({ request }) => (await import("@/lib/capture.server")).handleCapture(request) } },
});

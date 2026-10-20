import { createFileRoute } from "@tanstack/react-router";

export const Route = createFileRoute("/api/m365")({
  server: { handlers: { POST: async ({ request }) => (await import("@/lib/m365.server")).handleM365(request) } },
});

import { createFileRoute } from "@tanstack/react-router";

export const Route = createFileRoute("/api/update")({
  server: { handlers: { GET: async ({ request }) => (await import("@/lib/update.server")).handleUpdate(request), POST: async ({ request }) => (await import("@/lib/update.server")).handleUpdate(request) } },
});

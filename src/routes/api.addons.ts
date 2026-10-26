import { createFileRoute } from "@tanstack/react-router";

export const Route = createFileRoute("/api/addons")({
  server: {
    handlers: {
      GET: async ({ request }) => (await import("@/lib/addons.server")).handleAddons(request),
      POST: async ({ request }) => (await import("@/lib/addons.server")).handleAddons(request),
    },
  },
});

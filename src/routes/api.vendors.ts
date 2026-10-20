import { createFileRoute } from "@tanstack/react-router";

export const Route = createFileRoute("/api/vendors")({
  server: {
    handlers: {
      POST: async ({ request }) => (await import("@/lib/vendors.server")).handleVendors(request),
    },
  },
});

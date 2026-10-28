import { createFileRoute } from "@tanstack/react-router";

export const Route = createFileRoute("/api/vault")({
  server: {
    handlers: {
      GET: async ({ request }) => (await import("@/lib/vault.server")).handleVault(request),
      POST: async ({ request }) => (await import("@/lib/vault.server")).handleVault(request),
    },
  },
});

import { createFileRoute } from "@tanstack/react-router";
export const Route = createFileRoute("/api/meeting-vault")({
  server: { handlers: {
    GET: async ({ request }) => (await import("@/lib/meeting-vault.server")).handleMeetingVault(request),
    POST: async ({ request }) => (await import("@/lib/meeting-vault.server")).handleMeetingVault(request),
    PUT: async ({ request }) => (await import("@/lib/meeting-vault.server")).handleMeetingVault(request),
  } },
});

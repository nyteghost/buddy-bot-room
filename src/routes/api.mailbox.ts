import { createFileRoute } from "@tanstack/react-router";

export const Route = createFileRoute("/api/mailbox")({
  server: {
    handlers: {
      GET: async ({ request }) => (await import("@/lib/mailbox.server")).handleMailbox(request),
      POST: async ({ request }) => (await import("@/lib/mailbox.server")).handleMailbox(request),
    },
  },
});

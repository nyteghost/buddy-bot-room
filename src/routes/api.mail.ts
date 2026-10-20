import { createFileRoute } from "@tanstack/react-router";

export const Route = createFileRoute("/api/mail")({
  server: { handlers: { GET: async ({ request }) => (await import("@/lib/inbox.server")).handleMail(request) } },
});

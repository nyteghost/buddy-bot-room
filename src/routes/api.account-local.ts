import { createFileRoute } from "@tanstack/react-router";
import { handleAccountLocal } from "@/lib/account-local.server";

export const Route = createFileRoute("/api/account-local")({
  server: { handlers: { GET: ({ request }) => handleAccountLocal(request), PUT: ({ request }) => handleAccountLocal(request) } },
});

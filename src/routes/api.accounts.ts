import { createFileRoute } from "@tanstack/react-router";
import { handleAccountsApi } from "@/lib/accounts.server";

export const Route = createFileRoute("/api/accounts")({
  server: { handlers: { GET: ({ request }) => handleAccountsApi(request), POST: ({ request }) => handleAccountsApi(request), PUT: ({ request }) => handleAccountsApi(request), DELETE: ({ request }) => handleAccountsApi(request) } },
});

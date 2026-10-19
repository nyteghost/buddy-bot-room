import { createFileRoute } from "@tanstack/react-router";
import { handleStore } from "@/lib/store.server";

export const Route = createFileRoute("/api/store")({
  server: { handlers: { GET: ({ request }) => handleStore(request), PUT: ({ request }) => handleStore(request), POST: ({ request }) => handleStore(request), DELETE: ({ request }) => handleStore(request) } },
});

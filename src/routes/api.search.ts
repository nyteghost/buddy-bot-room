import { createFileRoute } from "@tanstack/react-router";
import { handleSearch } from "@/lib/search.server";

export const Route = createFileRoute("/api/search")({
  server: { handlers: { GET: ({ request }) => handleSearch(request) } },
});

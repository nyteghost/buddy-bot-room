import { createFileRoute } from "@tanstack/react-router";
import { handleKeyTest } from "@/lib/keytest.server";

export const Route = createFileRoute("/api/keytest")({
  server: { handlers: { POST: ({ request }) => handleKeyTest(request) } },
});

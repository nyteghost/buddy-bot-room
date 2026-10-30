import { createFileRoute } from "@tanstack/react-router";
import { handleJustStart } from "@/lib/focus-assist.server";

export const Route = createFileRoute("/api/just-start")({
  server: { handlers: { POST: ({ request }) => handleJustStart(request) } },
});

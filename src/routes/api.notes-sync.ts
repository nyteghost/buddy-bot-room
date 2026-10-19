import { createFileRoute } from "@tanstack/react-router";
import { handleNotesSync } from "@/lib/notes-sync.server";

export const Route = createFileRoute("/api/notes-sync")({
  server: { handlers: { POST: ({ request }) => handleNotesSync(request) } },
});

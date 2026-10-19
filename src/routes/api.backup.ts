import { createFileRoute } from "@tanstack/react-router";
import { handleBackup } from "@/lib/backup-api.server";

export const Route = createFileRoute("/api/backup")({
  server: { handlers: { GET: ({ request }) => handleBackup(request), POST: ({ request }) => handleBackup(request) } },
});

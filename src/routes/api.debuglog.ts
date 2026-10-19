import { createFileRoute } from "@tanstack/react-router";
import { backupText } from "@/lib/backup.server";
import { serverReport } from "@/lib/server-log.server";

export const Route = createFileRoute("/api/debuglog")({
  server: { handlers: { GET: async () => new Response(`${serverReport()}\n\nbackup:\n${await backupText().catch(() => "(unavailable)")}`, { headers: { "content-type": "text/plain; charset=utf-8", "cache-control": "no-store" } }) } },
});

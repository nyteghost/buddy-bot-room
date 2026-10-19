import { createFileRoute } from "@tanstack/react-router";
import { serverReport } from "@/lib/server-log.server";

export const Route = createFileRoute("/api/debuglog")({
  server: { handlers: { GET: () => new Response(serverReport(), { headers: { "content-type": "text/plain; charset=utf-8", "cache-control": "no-store" } }) } },
});

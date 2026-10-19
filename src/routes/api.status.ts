import { createFileRoute } from "@tanstack/react-router";

export const Route = createFileRoute("/api/status")({
  server: {
    handlers: {
      GET: async () => {
        const { collectStatus } = await import("@/lib/status.server");
        return new Response(JSON.stringify({ text: await collectStatus() }), { headers: { "content-type": "application/json" } });
      },
    },
  },
});

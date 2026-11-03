import { createFileRoute } from "@tanstack/react-router";
export const Route = createFileRoute("/api/working-pals")({
  server: { handlers: {
    GET: async ({request}) => (await import("@/lib/working-pals.server")).handleWorkingPals(request),
    POST: async ({request}) => (await import("@/lib/working-pals.server")).handleWorkingPals(request),
  }},
});

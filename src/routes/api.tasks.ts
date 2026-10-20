import { createFileRoute } from "@tanstack/react-router";

export const Route = createFileRoute("/api/tasks")({
  server: { handlers: { POST: async ({ request }) => (await import("@/lib/tasks.server")).handleTasks(request) } },
});

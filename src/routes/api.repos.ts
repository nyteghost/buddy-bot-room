import { createFileRoute } from "@tanstack/react-router";

export const Route = createFileRoute("/api/repos")({
  server: {
    handlers: {
      POST: async ({ request }) => (await import("@/lib/repos.server")).handleRepos(request),
    },
  },
});

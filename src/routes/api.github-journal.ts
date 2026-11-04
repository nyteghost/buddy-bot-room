import { createFileRoute } from "@tanstack/react-router";

export const Route = createFileRoute("/api/github-journal")({
  server: {
    handlers: {
      GET: async ({ request }) => (await import("@/lib/github-journal.server")).handleGitHubJournal(request),
      POST: async ({ request }) => (await import("@/lib/github-journal.server")).handleGitHubJournal(request),
    },
  },
});

import { createFileRoute } from "@tanstack/react-router";
import { handleEmbed } from "@/lib/embed.server";

export const Route = createFileRoute("/api/embed")({
  server: { handlers: { POST: ({ request }) => handleEmbed(request) } },
});

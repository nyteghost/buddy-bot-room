import { createFileRoute } from "@tanstack/react-router";
import { handleOllamaHealth } from "@/lib/ollama-health.server";
export const Route = createFileRoute("/api/ollama-health")({
  server: { handlers: { GET: ({ request }) => handleOllamaHealth(request) } },
});

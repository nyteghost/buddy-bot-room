import { createFileRoute } from "@tanstack/react-router";
import { handleOllamaApi } from "@/lib/ollama.server";

export const Route = createFileRoute("/api/ollama")({
  server: { handlers: { GET: ({ request }) => handleOllamaApi(request), POST: ({ request }) => handleOllamaApi(request) } },
});

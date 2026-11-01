import { createFileRoute } from "@tanstack/react-router";
import { handleOllamaConnect } from "@/lib/ollama-connect.server";
export const Route = createFileRoute("/api/ollama-connect")({ server: { handlers: { GET: ({ request }) => handleOllamaConnect(request), POST: ({ request }) => handleOllamaConnect(request) } } });

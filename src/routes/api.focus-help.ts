import { createFileRoute } from "@tanstack/react-router";
import { handleStuckHelp } from "@/lib/stuck-help.server";
export const Route = createFileRoute("/api/focus-help")({ server: { handlers: { POST: ({ request }) => handleStuckHelp(request) } } });

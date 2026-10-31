import { createFileRoute } from "@tanstack/react-router";
import { handleObsidianMemory } from "@/lib/obsidian-memory.server";
export const Route = createFileRoute("/api/obsidian-memory")({ server: { handlers: { GET: ({ request }) => handleObsidianMemory(request), PUT: ({ request }) => handleObsidianMemory(request) } } });

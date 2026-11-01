import { createFileRoute } from "@tanstack/react-router";
import { handleFocusFood } from "@/lib/focus-food.server";
export const Route = createFileRoute("/api/focus-food")({ server: { handlers: { POST: ({ request }) => handleFocusFood(request) } } });

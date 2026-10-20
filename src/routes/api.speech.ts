import { createFileRoute } from "@tanstack/react-router";

/** Cloud character voices were a Lovable-only feature. Pals use the free browser voice instead. */
export const Route = createFileRoute("/api/speech")({
  server: { handlers: { POST: () => Response.json({ error: "Cloud voices aren't set up here. The browser voice is used instead." }, { status: 501 }) } },
});

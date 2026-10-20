import { createFileRoute } from "@tanstack/react-router";

export const Route = createFileRoute("/api/weather")({
  server: { handlers: { GET: async () => (await import("@/lib/weather.server")).handleWeather() } },
});

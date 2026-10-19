import { createFileRoute } from "@tanstack/react-router";
import { currentProviders, providerFeedEnabled, refreshProviders } from "@/lib/provider-feed.server";

const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });

export const Route = createFileRoute("/api/providers")({
  server: {
    handlers: {
      GET: async () => json({ enabled: providerFeedEnabled(), feed: await currentProviders() }),
      POST: async () => (providerFeedEnabled() ? json({ enabled: true, feed: await refreshProviders() }) : json({ error: "Provider list updates are turned off (PROVIDER_FEED=0)." }, 400)),
    },
  },
});

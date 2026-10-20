import { createFileRoute } from "@tanstack/react-router";

export const Route = createFileRoute("/api/ics")({
  server: {
    handlers: {
      GET: async ({ request }) => {
        const { parseIcsQuery, buildIcs } = await import("@/lib/events");
        const ev = parseIcsQuery(new URL(request.url).searchParams);
        if (!ev) return new Response("Bad event", { status: 400 });
        const tz = (process.env["BUDDY_TZ"] ?? "UTC").trim() || "UTC";
        let zone = "UTC";
        try { new Intl.DateTimeFormat("en-US", { timeZone: tz }); zone = tz; } catch { /* keep UTC */ }
        const body = buildIcs(ev, crypto.randomUUID(), Date.now(), zone);
        return new Response(body, { headers: { "content-type": "text/calendar; charset=utf-8", "content-disposition": 'attachment; filename="event.ics"', "cache-control": "no-store" } });
      },
    },
  },
});

import { createServerFn } from "@tanstack/react-start";
import { getRequest } from "@tanstack/react-start/server";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";

const GATEWAY_BASE_URL = "https://connector-gateway.lovable.dev";
const CONNECTOR_ID = "google_calendar";
export const GOOGLE_CALENDAR_SCOPES = [
  "https://www.googleapis.com/auth/userinfo.email",
  "https://www.googleapis.com/auth/userinfo.profile",
  "https://www.googleapis.com/auth/calendar.events",
];

export const startCalendarConnect = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const clientKey = process.env["GOOGLE_CALENDAR_APP_USER_CONNECTOR_CLIENT_API_KEY"];
    if (!clientKey) throw new Error("GOOGLE_CALENDAR_APP_USER_CONNECTOR_CLIENT_API_KEY is not set");
    const request = getRequest();
    if (!request) throw new Error("OAuth must start from an app request.");
    const url = new URL(request.url);
    const sandboxHost = url.hostname === "localhost" ? request.headers.get("x-forwarded-host") : null;
    const returnUrl = new URL("/api/oauth/google/return", sandboxHost ? `https://${sandboxHost}` : url.origin).toString();
    const { getConnectionKeyForUser } = await import("./appUserConnections.server");
    const { authorizeAppUserOAuth } = await import("@/integrations/lovable/appUserConnector");
    const connectionAPIKey = await getConnectionKeyForUser(context.userId, CONNECTOR_ID);
    const { authorizationUrl } = await authorizeAppUserOAuth({
      gatewayBaseUrl: GATEWAY_BASE_URL,
      connectorId: CONNECTOR_ID,
      appUserId: context.userId,
      clientAPIKey: clientKey,
      returnUrl,
      connectionAPIKey: connectionAPIKey ?? undefined,
      credentialsConfiguration: { scopes: GOOGLE_CALENDAR_SCOPES },
    });
    return { authorizationUrl };
  });

export const completeCalendarConnect = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: { code: string }) => input)
  .handler(async ({ data, context }) => {
    const { exchangeAppUserOAuthCode } = await import("@/integrations/lovable/appUserConnector");
    const { saveConnectionKeyForUser } = await import("./appUserConnections.server");
    const { connectionAPIKey, connectorId } = await exchangeAppUserOAuthCode(GATEWAY_BASE_URL, data.code);
    if (connectorId !== CONNECTOR_ID) throw new Error("OAuth completion returned the wrong connector");
    await saveConnectionKeyForUser(context.userId, connectorId, connectionAPIKey);
    return { ok: true };
  });

export const calendarStatus = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const { getConnectionKeyForUser } = await import("./appUserConnections.server");
    const key = await getConnectionKeyForUser(context.userId, CONNECTOR_ID);
    return { connected: Boolean(key) };
  });

type ShiftInput = { date: string; start: number; end: number; raw: string };

const pad = (n: number) => String(n).padStart(2, "0");
function localStamp(date: string, min: number) {
  const d = new Date(`${date}T00:00:00Z`);
  d.setUTCMinutes(min);
  return `${d.getUTCFullYear()}-${pad(d.getUTCMonth() + 1)}-${pad(d.getUTCDate())}T${pad(d.getUTCHours())}:${pad(d.getUTCMinutes())}:00`;
}

export const pushShiftsToCalendar = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: { shifts: ShiftInput[] }) => input)
  .handler(async ({ data, context }) => {
    const { getConnectionKeyForUser } = await import("./appUserConnections.server");
    const { appUserReconnectRequired, callAsAppUser } = await import("@/integrations/lovable/appUserConnector");
    const connectionAPIKey = await getConnectionKeyForUser(context.userId, CONNECTOR_ID);
    if (!connectionAPIKey) return { connected: false as const };
    let added = 0;
    let skipped = 0;
    const reasons: string[] = [];
    for (const s of data.shifts.slice(0, 60)) {
      const res = await callAsAppUser({
        gatewayBaseUrl: GATEWAY_BASE_URL,
        connectionAPIKey,
        connectorId: CONNECTOR_ID,
        path: "/calendar/v3/calendars/primary/events",
        requiredScopes: GOOGLE_CALENDAR_SCOPES,
        init: {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            summary: "Work shift — Show Services",
            description: `Schedule: ${s.raw}`,
            start: { dateTime: localStamp(s.date, s.start), timeZone: "America/New_York" },
            end: { dateTime: localStamp(s.date, s.end), timeZone: "America/New_York" },
          }),
        },
      });
      if (await appUserReconnectRequired(res)) return { connected: false as const, reconnectRequired: true };
      if (res.ok) added++;
      else {
        skipped++;
        const body = await res.text();
        console.error(`Calendar event insert failed [${res.status}]: ${body}`);
        let detail = `Google said no (${res.status})`;
        try {
          const parsed = JSON.parse(body);
          const msg = parsed?.error?.message ?? parsed?.message;
          if (typeof msg === "string" && msg) detail = msg;
        } catch { /* keep default */ }
        reasons.push(`${s.date} ${s.raw}: ${detail}`);
      }
    }
    return { connected: true as const, added, skipped, reasons };
  });

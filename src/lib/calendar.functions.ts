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

type ShiftInput = { id?: string; date: string; start: number; end: number; raw: string; note?: string };

const pad = (n: number) => String(n).padStart(2, "0");
function localStamp(date: string, min: number) {
  const d = new Date(`${date}T00:00:00Z`);
  d.setUTCMinutes(min);
  return `${d.getUTCFullYear()}-${pad(d.getUTCMonth() + 1)}-${pad(d.getUTCDate())}T${pad(d.getUTCHours())}:${pad(d.getUTCMinutes())}:00`;
}

const EVENT_ID = /^[a-v0-9]{5,100}$/;
const clean = (s: unknown, max: number) => String(s ?? "").replace(/[\r\n]+/g, " ").trim().slice(0, max);

function validShift(s: ShiftInput): boolean {
  return /^\d{4}-\d{2}-\d{2}$/.test(s.date) && Number.isFinite(s.start) && Number.isFinite(s.end) && s.start >= 0 && s.end > s.start && s.end <= 2880 && (!s.id || EVENT_ID.test(s.id));
}

/**
 * Adds each shift as an event. A shift with an id is created under that id, so pushing again after an edit updates the same
 * event instead of adding a copy. `remove` lists ids of shifts you deleted since the last push; they are deleted from the calendar too.
 */
export const pushShiftsToCalendar = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: { shifts: ShiftInput[]; title?: string; remove?: string[] }) => input)
  .handler(async ({ data, context }) => {
    const { getConnectionKeyForUser } = await import("./appUserConnections.server");
    const { appUserReconnectRequired, callAsAppUser } = await import("@/integrations/lovable/appUserConnector");
    const connectionAPIKey = await getConnectionKeyForUser(context.userId, CONNECTOR_ID);
    if (!connectionAPIKey) return { connected: false as const };
    const title = clean(data.title, 120) || "Mark Work";
    let added = 0;
    let updated = 0;
    let removed = 0;
    let skipped = 0;
    const reasons: string[] = [];
    const call = (path: string, method: string, body?: unknown) => callAsAppUser({
      gatewayBaseUrl: GATEWAY_BASE_URL,
      connectionAPIKey,
      connectorId: CONNECTOR_ID,
      path,
      requiredScopes: GOOGLE_CALENDAR_SCOPES,
      init: { method, ...(body ? { headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) } : {}) },
    });
    const explain = async (res: Response) => {
      const body = await res.text();
      console.error(`Calendar request failed [${res.status}]: ${body}`);
      let detail = `Google said no (${res.status})`;
      try {
        const parsed = JSON.parse(body);
        const msg = parsed?.error?.message ?? parsed?.message;
        if (typeof msg === "string" && msg) detail = msg;
      } catch { /* keep default */ }
      return detail;
    };
    for (const id of (data.remove ?? []).filter((x) => EVENT_ID.test(x)).slice(0, 60)) {
      const res = await call(`/calendar/v3/calendars/primary/events/${id}`, "DELETE");
      if (await appUserReconnectRequired(res)) return { connected: false as const, reconnectRequired: true };
      if (res.ok || res.status === 404 || res.status === 410) removed++;
      else { skipped++; reasons.push(`remove ${id}: ${await explain(res)}`); }
    }
    for (const s of data.shifts.slice(0, 60)) {
      if (!validShift(s)) { skipped++; reasons.push(`${clean(s.date, 12)}: that shift has a bad date or time`); continue; }
      const event = {
        summary: title,
        status: "confirmed",
        description: `Schedule: ${clean(s.raw, 100)}${clean(s.note, 300) ? `\n${clean(s.note, 300)}` : ""}`,
        start: { dateTime: localStamp(s.date, s.start), timeZone: "America/New_York" },
        end: { dateTime: localStamp(s.date, s.end), timeZone: "America/New_York" },
      };
      let res = await call("/calendar/v3/calendars/primary/events", "POST", s.id ? { ...event, id: s.id } : event);
      if (await appUserReconnectRequired(res)) return { connected: false as const, reconnectRequired: true };
      let wasUpdate = false;
      if (res.status === 409 && s.id) { res = await call(`/calendar/v3/calendars/primary/events/${s.id}`, "PUT", event); wasUpdate = true; }
      if (res.ok) { wasUpdate ? updated++ : added++; }
      else { skipped++; reasons.push(`${s.date} ${s.raw}: ${await explain(res)}`); }
    }
    return { connected: true as const, added, updated, removed, skipped, reasons };
  });

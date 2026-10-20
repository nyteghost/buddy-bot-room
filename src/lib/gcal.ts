/** Google Calendar for shifts when Pixel Pals runs on your own server. Pure helpers; the sign-in and API calls are in gcal.server.ts. */
export type ShiftInput = { id?: string; date: string; start: number; end: number; raw: string; note?: string };

/** Google event ids may only use a–v and 0–9, 5–100 characters. Shift ids are made that way. */
export const EVENT_ID = /^[a-v0-9]{5,100}$/;
export const SCOPE = "https://www.googleapis.com/auth/calendar.events";

const pad = (n: number) => String(n).padStart(2, "0");
export const clean = (s: unknown, max: number): string => String(s ?? "").replace(/[\r\n]+/g, " ").trim().slice(0, max);

/** Wall-clock stamp for a date plus minutes after midnight (minutes past 1440 roll into the next day). */
export function localStamp(date: string, min: number): string {
  const d = new Date(`${date}T00:00:00Z`);
  d.setUTCMinutes(min);
  return `${d.getUTCFullYear()}-${pad(d.getUTCMonth() + 1)}-${pad(d.getUTCDate())}T${pad(d.getUTCHours())}:${pad(d.getUTCMinutes())}:00`;
}

export function validShift(s: ShiftInput): boolean {
  return /^\d{4}-\d{2}-\d{2}$/.test(String(s.date)) && Number.isFinite(s.start) && Number.isFinite(s.end) && s.start >= 0 && s.end > s.start && s.end <= 2880 && (!s.id || EVENT_ID.test(s.id));
}

export function buildEvent(s: ShiftInput, title: string, zone: string) {
  const note = clean(s.note, 300);
  return {
    summary: clean(title, 120) || "Work",
    status: "confirmed",
    description: `Schedule: ${clean(s.raw, 100)}${note ? `\n${note}` : ""}`,
    start: { dateTime: localStamp(s.date, s.start), timeZone: zone },
    end: { dateTime: localStamp(s.date, s.end), timeZone: zone },
  };
}

export function authUrl(clientId: string, redirectUri: string, state: string): string {
  const q = new URLSearchParams({ client_id: clientId, redirect_uri: redirectUri, response_type: "code", scope: SCOPE, access_type: "offline", prompt: "consent", include_granted_scopes: "true", state });
  return `https://accounts.google.com/o/oauth2/v2/auth?${q.toString()}`;
}

/** The address the browser used to reach Pixel Pals, checked so it can't be used for anything but a redirect base. */
export function cleanOrigin(raw: unknown): string | null {
  try {
    const u = new URL(String(raw ?? ""));
    if (u.protocol !== "https:" && !(u.protocol === "http:" && (u.hostname === "localhost" || u.hostname === "127.0.0.1"))) return null;
    return u.origin;
  } catch { return null; }
}
export const redirectUri = (origin: string): string => `${origin}/api/google/callback`;

export type Tokens = { refresh_token: string };
export function parseTokenResponse(json: unknown): { access: string; expiresIn: number; refresh?: string } | null {
  const j = json as { access_token?: unknown; expires_in?: unknown; refresh_token?: unknown } | null;
  if (!j || typeof j.access_token !== "string" || !j.access_token) return null;
  return { access: j.access_token, expiresIn: typeof j.expires_in === "number" ? j.expires_in : 3000, ...(typeof j.refresh_token === "string" && j.refresh_token ? { refresh: j.refresh_token } : {}) };
}

/** A short, plain explanation of a Google API error body. */
export function explainGoogle(status: number, body: string): string {
  let detail = `Google said no (${status})`;
  try {
    const msg = (JSON.parse(body) as { error?: { message?: string } | string; error_description?: string })?.error;
    const m = typeof msg === "string" ? msg : msg?.message;
    if (typeof m === "string" && m) detail = m.slice(0, 160);
  } catch { /* keep default */ }
  return detail;
}

/** Rebuild a private key from whatever was pasted: the JSON's escaped \\n text, real line breaks, or spaces (the settings field flattens lines). */
export function normalizePrivateKey(raw: string): string | null {
  const body = String(raw ?? "").replace(/\\n/g, "\n").replace(/-----(BEGIN|END) [A-Z ]*PRIVATE KEY-----/g, "").replace(/["',\s]/g, "");
  if (!/^[A-Za-z0-9+/=]{200,}$/.test(body)) return null;
  const lines = body.match(/.{1,64}/g) ?? [];
  return `-----BEGIN PRIVATE KEY-----\n${lines.join("\n")}\n-----END PRIVATE KEY-----\n`;
}

export const b64url = (s: string): string => Buffer.from(s, "utf8").toString("base64url");
/** The unsigned part of a service-account sign-in request. */
export function serviceJwtParts(email: string, nowSec: number): string {
  return `${b64url(JSON.stringify({ alg: "RS256", typ: "JWT" }))}.${b64url(JSON.stringify({ iss: email, scope: SCOPE, aud: "https://oauth2.googleapis.com/token", iat: nowSec, exp: nowSec + 3300 }))}`;
}

/** Read a downloaded service-account JSON key file. Returns just the two values the app needs, or null if it isn't one. */
export function parseServiceKeyFile(text: string): { email: string; key: string } | null {
  try {
    const j = JSON.parse(text) as { type?: unknown; client_email?: unknown; private_key?: unknown };
    if (j.type !== "service_account" || typeof j.client_email !== "string" || typeof j.private_key !== "string") return null;
    if (!/^[^\s@]+@[^\s@]+\.gserviceaccount\.com$/.test(j.client_email) || !normalizePrivateKey(j.private_key)) return null;
    return { email: j.client_email, key: j.private_key };
  } catch { return null; }
}

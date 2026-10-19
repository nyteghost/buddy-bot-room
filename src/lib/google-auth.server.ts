import { readCookie, safeEqual } from "./cookies";
import { logServer } from "./server-log.server";

/**
 * Google sign-in for the self-hosted build (server-side OAuth / OpenID Connect, "authorization code" flow).
 * Turned on by GOOGLE_CLIENT_ID + GOOGLE_CLIENT_SECRET. Only emails in GOOGLE_ALLOWED_EMAILS get in
 * (comma separated; "@example.com" allows a whole domain). The session is an HMAC-signed, HttpOnly cookie.
 * The id token is received straight from Google's token endpoint over TLS, as OpenID Connect allows,
 * and its audience, issuer, expiry, nonce and email_verified are checked.
 */
export type GoogleConfig = { clientId: string; clientSecret: string; allowed: string[]; publicUrl: string };
export type GoogleUser = { email: string; name: string; sub: string };

export const SESSION_COOKIE = "buddy_google";
const STATE_COOKIE = "buddy_oauth";
const SESSION_SECONDS = 30 * 24 * 3600;
const AUTH_URL = "https://accounts.google.com/o/oauth2/v2/auth";
const TOKEN_URL = "https://oauth2.googleapis.com/token";

export function googleConfig(env: Record<string, string | undefined>): GoogleConfig | null {
  const clientId = (env["GOOGLE_CLIENT_ID"] ?? "").trim();
  const clientSecret = (env["GOOGLE_CLIENT_SECRET"] ?? "").trim();
  if (!clientId || !clientSecret) return null;
  const allowed = (env["GOOGLE_ALLOWED_EMAILS"] ?? "").split(/[,\s]+/).map((s) => s.trim().toLowerCase()).filter(Boolean);
  let publicUrl = "";
  const raw = (env["BUDDY_PUBLIC_URL"] ?? "").trim();
  if (raw) {
    try {
      const u = new URL(raw);
      if (u.protocol === "http:" || u.protocol === "https:") publicUrl = u.origin;
    } catch { /* ignored: falls back to the request's own address */ }
  }
  return { clientId, clientSecret, allowed, publicUrl };
}

export function isAllowedEmail(email: string, allowed: string[]): boolean {
  const e = email.trim().toLowerCase();
  if (!e.includes("@")) return false;
  return allowed.some((a) => (a.startsWith("@") ? e.endsWith(a) : e === a));
}

/** The address the browser used (Tailscale/Caddy pass X-Forwarded-Proto). BUDDY_PUBLIC_URL wins when set. */
export function originOf(request: Request, cfg: GoogleConfig): string {
  if (cfg.publicUrl) return cfg.publicUrl;
  const url = new URL(request.url);
  const proto = request.headers.get("x-forwarded-proto")?.split(",")[0]?.trim() || url.protocol.replace(":", "");
  const host = request.headers.get("x-forwarded-host")?.split(",")[0]?.trim() || request.headers.get("host") || url.host;
  return `${proto}://${host}`;
}

const bytesToB64u = (bytes: Uint8Array): string => btoa(String.fromCharCode(...bytes)).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
const textToB64u = (text: string): string => bytesToB64u(new TextEncoder().encode(text));
function b64uToText(s: string): string {
  const bin = atob(s.replace(/-/g, "+").replace(/_/g, "/") + "===".slice((s.length + 3) % 4));
  return new TextDecoder().decode(Uint8Array.from(bin, (c) => c.charCodeAt(0)));
}

async function hmac(secret: string, data: string): Promise<string> {
  const key = await crypto.subtle.importKey("raw", new TextEncoder().encode(`pixel-pals-google:${secret}`), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  return bytesToB64u(new Uint8Array(await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(data))));
}

export async function signSession(user: GoogleUser, secret: string, now = Date.now()): Promise<string> {
  const payload = textToB64u(JSON.stringify({ e: user.email, n: user.name, s: user.sub, x: Math.floor(now / 1000) + SESSION_SECONDS }));
  return `${payload}.${await hmac(secret, payload)}`;
}

export async function readSession(value: string, secret: string, now = Date.now()): Promise<GoogleUser | null> {
  const parts = value.split(".");
  if (parts.length !== 2 || !parts[0] || !parts[1]) return null;
  if (!safeEqual(await hmac(secret, parts[0]), parts[1])) return null;
  try {
    const p = JSON.parse(b64uToText(parts[0])) as Record<string, unknown>;
    if (typeof p["e"] !== "string" || typeof p["x"] !== "number" || p["x"] * 1000 < now) return null;
    return { email: p["e"], name: typeof p["n"] === "string" ? p["n"] : "", sub: typeof p["s"] === "string" ? p["s"] : "" };
  } catch { return null; }
}

/** The signed-in, still-allowed user for this request, or null. Removing an email from the list ends its access at once. */
export async function googleUser(request: Request, cfg: GoogleConfig | null, now = Date.now()): Promise<GoogleUser | null> {
  if (!cfg) return null;
  const value = readCookie(request.headers.get("cookie"), SESSION_COOKIE);
  if (!value) return null;
  const user = await readSession(value, cfg.clientSecret, now);
  return user && isAllowedEmail(user.email, cfg.allowed) ? user : null;
}

export function authUrl(cfg: GoogleConfig, redirectUri: string, state: string, nonce: string): string {
  return `${AUTH_URL}?${new URLSearchParams({
    client_id: cfg.clientId, redirect_uri: redirectUri, response_type: "code", scope: "openid email profile",
    state, nonce, prompt: "select_account",
  })}`;
}

export function decodeIdToken(idToken: string): Record<string, unknown> | null {
  const payload = idToken.split(".")[1];
  if (!payload) return null;
  try { return JSON.parse(b64uToText(payload)) as Record<string, unknown>; } catch { return null; }
}

export function checkClaims(claims: Record<string, unknown> | null, clientId: string, nonce: string, now = Date.now()): { user: GoogleUser } | { error: string } {
  if (!claims) return { error: "Google's answer couldn't be read." };
  const iss = claims["iss"];
  if (iss !== "https://accounts.google.com" && iss !== "accounts.google.com") return { error: "The sign-in didn't come from Google." };
  const aud = claims["aud"];
  if (aud !== clientId) return { error: "The sign-in was for a different app (check GOOGLE_CLIENT_ID)." };
  if (typeof claims["exp"] !== "number" || claims["exp"] * 1000 < now) return { error: "The sign-in expired. Try again." };
  if (typeof claims["nonce"] !== "string" || !safeEqual(claims["nonce"], nonce)) return { error: "The sign-in didn't match this browser. Try again." };
  const email = claims["email"];
  if (typeof email !== "string" || !email) return { error: "Google didn't share an email address." };
  if (claims["email_verified"] !== true) return { error: "That Google email isn't verified." };
  return { user: { email, name: typeof claims["name"] === "string" ? claims["name"] : "", sub: typeof claims["sub"] === "string" ? claims["sub"] : "" } };
}

const esc = (s: string): string => s.replace(/[<>&"']/g, "");
export function noticePage(message: string, status: number): Response {
  return new Response(
    `<!doctype html><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Pixel Pals</title>
<style>body{margin:0;min-height:100vh;display:grid;place-items:center;background:#14121f;color:#eee;font:16px system-ui,sans-serif}main{width:min(420px,86vw);display:grid;gap:12px}a{color:#a99cff}</style>
<main><h1 style="font-size:20px;margin:0">Pixel Pals</h1><p>${esc(message)}</p><a href="/">Back to sign in</a></main>`,
    { status, headers: { "content-type": "text/html; charset=utf-8", "cache-control": "no-store" } },
  );
}

const randomHex = (n = 16): string => [...crypto.getRandomValues(new Uint8Array(n))].map((b) => b.toString(16).padStart(2, "0")).join("");

/** Handles /__google, /__google/callback and /__logout. Returns null for any other path. */
export async function handleGoogle(request: Request, cfg: GoogleConfig, now = Date.now()): Promise<Response | null> {
  const url = new URL(request.url);
  const origin = originOf(request, cfg);
  const secure = origin.startsWith("https:") ? "; Secure" : "";
  const redirectUri = `${origin}/__google/callback`;

  if (url.pathname === "/__logout") {
    return new Response(null, { status: 303, headers: { location: "/", "set-cookie": `${SESSION_COOKIE}=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0${secure}` } });
  }
  if (url.pathname === "/__google") {
    if (!cfg.allowed.length) return noticePage("Google sign-in is on, but GOOGLE_ALLOWED_EMAILS is empty, so nobody can get in. Add your email address to it.", 403);
    const state = randomHex();
    const nonce = randomHex();
    return new Response(null, {
      status: 303,
      headers: { location: authUrl(cfg, redirectUri, state, nonce), "set-cookie": `${STATE_COOKIE}=${state}.${nonce}; Path=/__google; HttpOnly; SameSite=Lax; Max-Age=600${secure}` },
    });
  }
  if (url.pathname === "/__google/callback") {
    const [state = "", nonce = ""] = readCookie(request.headers.get("cookie"), STATE_COOKIE).split(".");
    const given = url.searchParams.get("state") ?? "";
    const code = url.searchParams.get("code") ?? "";
    const googleError = url.searchParams.get("error");
    if (googleError) return noticePage(`Google said: ${googleError}.`, 400);
    if (!state || !nonce || !code || !safeEqual(given, state)) return noticePage("That sign-in didn't match this browser. Start again from the sign-in page.", 400);
    let claims: Record<string, unknown> | null = null;
    try {
      const res = await fetch(TOKEN_URL, {
        method: "POST",
        headers: { "content-type": "application/x-www-form-urlencoded" },
        body: new URLSearchParams({ code, client_id: cfg.clientId, client_secret: cfg.clientSecret, redirect_uri: redirectUri, grant_type: "authorization_code" }),
        signal: AbortSignal.timeout(10000),
      });
      const json = (await res.json().catch(() => ({}))) as Record<string, unknown>;
      if (!res.ok || typeof json["id_token"] !== "string") {
        const why = typeof json["error"] === "string" ? json["error"] : String(res.status);
        logServer("warn", `Google sign-in: token exchange failed (${why}); redirect uri sent was ${redirectUri}`);
        return noticePage(`Google didn't accept the sign-in (${why}). Check that ${redirectUri} is listed as an authorized redirect URI, and that the client secret is right.`, 502);
      }
      claims = decodeIdToken(json["id_token"]);
    } catch (error) {
      logServer("error", "Google sign-in: can't reach Google", error);
      return noticePage("Couldn't reach Google. Check the server's internet access.", 502);
    }
    const checked = checkClaims(claims, cfg.clientId, nonce, now);
    if ("error" in checked) {
      logServer("warn", `Google sign-in refused: ${checked.error}`);
      return noticePage(checked.error, 400);
    }
    if (!isAllowedEmail(checked.user.email, cfg.allowed)) {
      logServer("warn", `Google sign-in refused: ${checked.user.email} is not in GOOGLE_ALLOWED_EMAILS`);
      return noticePage(`${checked.user.email} isn't on this server's allowed list. Ask the owner to add it to GOOGLE_ALLOWED_EMAILS.`, 403);
    }
    const headers = new Headers({ location: "/" });
    headers.append("set-cookie", `${SESSION_COOKIE}=${await signSession(checked.user, cfg.clientSecret, now)}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${SESSION_SECONDS}${secure}`);
    headers.append("set-cookie", `${STATE_COOKIE}=; Path=/__google; HttpOnly; SameSite=Lax; Max-Age=0${secure}`);
    return new Response(null, { status: 303, headers });
  }
  return null;
}

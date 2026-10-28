/**
 * Optional shared-password gate for the self-hosted build.
 * Set BUDDY_PASSWORD in the server environment to turn it on; unset (local dev) it does nothing.
 * The cookie holds a SHA-256 of the password, never the password itself, and is HttpOnly.
 */
import { readCookie, safeEqual } from "./cookies";
import { createLimiter } from "./rate-limit";
import { readSession, signSession } from "./accounts";
import { accountsEnabled } from "./accounts";
import { authPage, currentUser, handleAccounts, tokenUser } from "./accounts.server";

const COOKIE = "buddy_auth";
const MAX_FAILS = 8;
const WINDOW_MS = 10 * 60 * 1000;
/** 8 wrong tries per address, and 40 for the whole server in 10 minutes (the address header can be faked by anyone who reaches the port). */
export const loginLimiter = createLimiter({ max: MAX_FAILS, windowMs: WINDOW_MS, globalMax: 40 });

async function digest(password: string): Promise<string> {
  const bytes = new TextEncoder().encode(`pixel-pals-gate:${password}`);
  const hash = await crypto.subtle.digest("SHA-256", bytes);
  return [...new Uint8Array(hash)].map((b) => b.toString(16).padStart(2, "0")).join("");
}

export { readCookie, safeEqual };

/**
 * Sessions are signed tokens with an expiry (30 days), not a fixed hash of the password: a copied cookie stops working when it expires,
 * and changing BUDDY_PASSWORD signs everyone out. The signing key is random, kept in BUDDY_DATA_DIR/gate.key (mode 600) so sessions
 * survive a restart; without a data folder it lives in memory only.
 */
let keyCache: string | undefined;
async function gateKey(): Promise<string> {
  if (keyCache) return keyCache;
  const rand = [...crypto.getRandomValues(new Uint8Array(32))].map((b) => b.toString(16).padStart(2, "0")).join("");
  const dir = typeof process !== "undefined" ? (process.env["BUDDY_DATA_DIR"] ?? "").trim().replace(/\/+$/, "") : "";
  if (!dir) return (keyCache = rand);
  try {
    const fs = (await import(/* @vite-ignore */ "node:" + "fs/promises")) as typeof import("node:fs/promises");
    const path = `${dir}/gate.key`;
    let value = "";
    try { value = (await fs.readFile(path, "utf8")).trim(); } catch (e) { if ((e as { code?: string }).code !== "ENOENT") throw e; }
    if (!value) {
      await fs.mkdir(dir, { recursive: true });
      try { await fs.writeFile(path, rand, { encoding: "utf8", mode: 0o600, flag: "wx" }); value = rand; }
      catch { value = (await fs.readFile(path, "utf8")).trim(); }
    }
    return (keyCache = value || rand);
  } catch {
    return (keyCache = rand); // no writable folder: sessions last until the next restart
  }
}
const sessionSecret = async (password: string) => `${await gateKey()}:${await digest(password)}`;

function loginPage(message = ""): Response {
  const note = message ? `<p class="err">${message.replace(/[<>&]/g, "")}</p>` : "";
  return new Response(
    `<!doctype html><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Pixel Pals</title>
<style>body{margin:0;min-height:100vh;display:grid;place-items:center;background:#14121f;color:#eee;font:16px system-ui,sans-serif}
form{display:grid;gap:12px;width:min(320px,86vw)}h1{font-size:20px;margin:0}input,button{font:inherit;padding:10px 12px;border-radius:8px;border:1px solid #55507a;background:#201d33;color:#fff}
button{background:#7c6cf0;border:0;cursor:pointer}.err{color:#ff8a8a;margin:0}</style>
<form method="post" action="/__login"><h1>Pixel Pals</h1>${note}<input type="password" name="password" placeholder="Password" autofocus autocomplete="current-password"><button>Enter</button></form>`,
    { status: 401, headers: { "content-type": "text/html; charset=utf-8", "cache-control": "no-store" } },
  );
}

/** Icons and the app manifest are public: the browser fetches them without cookies when installing the app. */
export const PUBLIC_FILES = new Set(["/manifest.webmanifest", "/today.webmanifest", "/apple-touch-icon.png", "/icon-192.png", "/icon-512.png", "/icon-maskable-512.png", "/favicon.svg", "/robots.txt"]);

export function isGateOn(password: string | undefined): password is string {
  return typeof password === "string" && password.length > 0;
}

/**
 * Returns a Response when the request must be stopped (login page, login handling, 401),
 * or null when the request may continue to the app.
 */
export async function gate(
  request: Request,
  password: string | undefined,
  now = Date.now(),
  accounts: boolean = accountsEnabled(typeof process !== "undefined" ? process.env : {}),
): Promise<Response | null> {
  const url = new URL(request.url);
  if (url.pathname === "/__health" || PUBLIC_FILES.has(url.pathname)) return null;
  if (accounts) {
    // Built-in accounts: sign in (or create the first account) instead of the shared password.
    const handled = await handleAccounts(request, now);
    if (handled) return handled;
    if (await currentUser(request, now)) return null;
    // The iPhone Shortcut has no cookie: it sends an access token, accepted for the note sync only.
    if (url.pathname === "/api/notes-sync" && (await tokenUser(request))) return null;
    if (url.pathname === "/api/capture" && request.method === "POST" && (await tokenUser(request))) return null;
    if (url.pathname === "/api/today-capture" && request.method === "POST" && (await tokenUser(request))) return null;
    if (url.pathname.startsWith("/api/")) return Response.json({ error: "Sign in required." }, { status: 401 });
    return authPage();
  }
  if (url.pathname === "/__me") return Response.json({ accounts: false }, { headers: { "cache-control": "no-store" } });
  if (!isGateOn(password)) return null;
  const expected = await digest(password);
  if (url.pathname === "/__login" && request.method === "POST") {
    const ip = request.headers.get("x-forwarded-for")?.split(",")[0]?.trim() || "local";
    if (loginLimiter.blocked(ip, now)) return loginPage("Too many tries. Wait a few minutes.");
    const form = await request.formData().catch(() => null);
    const given = typeof form?.get("password") === "string" ? String(form?.get("password")) : "";
    if (!safeEqual(await digest(given), expected)) {
      loginLimiter.fail(ip, now);
      return loginPage("Wrong password.");
    }
    loginLimiter.clear(ip);
    const secure = url.protocol === "https:" || request.headers.get("x-forwarded-proto")?.split(",")[0]?.trim() === "https" ? "; Secure" : "";
    return new Response(null, {
      status: 303,
      headers: {
        location: "/",
        "set-cookie": `${COOKIE}=${await signSession("gate", await sessionSecret(password), now)}; Path=/; HttpOnly; SameSite=Lax; Max-Age=2592000${secure}`,
      },
    });
  }
  if ((await readSession(readCookie(request.headers.get("cookie"), COOKIE), await sessionSecret(password), now)) === "gate") return null;
  if (url.pathname.startsWith("/api/")) return Response.json({ error: "Password required." }, { status: 401 });
  return loginPage();
}

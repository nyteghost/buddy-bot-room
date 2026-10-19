/**
 * Optional shared-password gate for the self-hosted build.
 * Set BUDDY_PASSWORD in the server environment to turn it on; unset (Lovable, local dev) it does nothing.
 * The cookie holds a SHA-256 of the password, never the password itself, and is HttpOnly.
 */
const COOKIE = "buddy_auth";
const MAX_FAILS = 8;
const WINDOW_MS = 10 * 60 * 1000;
const fails = new Map<string, { n: number; first: number }>();

async function digest(password: string): Promise<string> {
  const bytes = new TextEncoder().encode(`pixel-pals-gate:${password}`);
  const hash = await crypto.subtle.digest("SHA-256", bytes);
  return [...new Uint8Array(hash)].map((b) => b.toString(16).padStart(2, "0")).join("");
}

/** Compare without bailing out at the first differing character. */
export function safeEqual(a: string, b: string): boolean {
  let diff = a.length ^ b.length;
  const len = Math.max(a.length, b.length);
  for (let i = 0; i < len; i++) diff |= (a.charCodeAt(i) || 0) ^ (b.charCodeAt(i) || 0);
  return diff === 0;
}

export function readCookie(header: string | null, name: string): string {
  for (const part of (header ?? "").split(";")) {
    const [k, ...rest] = part.trim().split("=");
    if (k === name) return rest.join("=");
  }
  return "";
}

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

export function isGateOn(password: string | undefined): password is string {
  return typeof password === "string" && password.length > 0;
}

/**
 * Returns a Response when the request must be stopped (login page, login handling, 401),
 * or null when the request may continue to the app.
 */
export async function gate(request: Request, password: string | undefined, now = Date.now()): Promise<Response | null> {
  if (!isGateOn(password)) return null;
  const url = new URL(request.url);
  const expected = await digest(password);
  if (url.pathname === "/__health") return null;
  if (url.pathname === "/__login" && request.method === "POST") {
    const ip = request.headers.get("x-forwarded-for")?.split(",")[0]?.trim() || "local";
    const seen = fails.get(ip);
    if (seen && now - seen.first > WINDOW_MS) fails.delete(ip);
    const current = fails.get(ip);
    if (current && current.n >= MAX_FAILS) return loginPage("Too many tries. Wait a few minutes.");
    const form = await request.formData().catch(() => null);
    const given = typeof form?.get("password") === "string" ? String(form?.get("password")) : "";
    if (!safeEqual(await digest(given), expected)) {
      fails.set(ip, { n: (current?.n ?? 0) + 1, first: current?.first ?? now });
      return loginPage("Wrong password.");
    }
    fails.delete(ip);
    const secure = url.protocol === "https:" ? "; Secure" : "";
    return new Response(null, {
      status: 303,
      headers: {
        location: "/",
        "set-cookie": `${COOKIE}=${expected}; Path=/; HttpOnly; SameSite=Lax; Max-Age=2592000${secure}`,
      },
    });
  }
  if (safeEqual(readCookie(request.headers.get("cookie"), COOKIE), expected)) return null;
  if (url.pathname.startsWith("/api/")) return Response.json({ error: "Password required." }, { status: 401 });
  return loginPage();
}

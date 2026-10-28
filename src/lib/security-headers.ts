/**
 * Browser-hardening headers added to every response (only when the response has not set its own):
 * no MIME sniffing, no sending the full address to other sites, and the app can't be framed by another site.
 * No full script policy on purpose: the app uses inline styles, workers (PDF viewer) and blob URLs.
 */
export const SECURITY_HEADERS: Record<string, string> = {
  "x-content-type-options": "nosniff",
  "referrer-policy": "same-origin",
  "x-frame-options": "SAMEORIGIN",
};
const FRAME_CSP = "frame-ancestors 'self'";

/** `allowFraming` (ALLOW_FRAMING=1) leaves out the anti-framing headers, for people who show Pixel Pals inside a dashboard on purpose. */
export function applySecurityHeaders(res: Response, o: { allowFraming?: boolean } = {}): Response {
  const missing = Object.entries(SECURITY_HEADERS).filter(([k]) => !(o.allowFraming && k === "x-frame-options") && !res.headers.has(k));
  const needCsp = !o.allowFraming && !res.headers.has("content-security-policy");
  if (!missing.length && !needCsp) return res;
  const set = (h: Headers) => {
    for (const [k, v] of missing) h.set(k, v);
    // A page that already carries its own policy (sandboxed attachments, add-on pages) keeps it as is.
    if (needCsp) h.set("content-security-policy", FRAME_CSP);
  };
  try { set(res.headers); return res; }
  catch { // immutable headers (a response made by fetch or Response.redirect): copy it
    const copy = new Response(res.body, { status: res.status, statusText: res.statusText, headers: new Headers(res.headers) });
    set(copy.headers);
    return copy;
  }
}

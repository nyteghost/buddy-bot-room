import { logServer } from "./server-log.server";
import { shapeSeerr } from "./seerr";

/** Seerr credentials come from protected server settings or environment, never a chat/request body. */
function config(): { base: string; key: string } | null {
  const base = (process.env["SEERR_URL"] ?? "").trim().replace(/\/+$/, "");
  const key = (process.env["SEERR_API_KEY"] ?? "").trim();
  if (!base || !key) return null;
  try {
    const url = new URL(base);
    return url.protocol === "http:" || url.protocol === "https:" ? { base, key } : null;
  } catch {
    return null;
  }
}
const notSetUp = () =>
  Response.json(
    {
      error:
        "Seerr isn't set up. Open Settings → Integrations → Movies & shows → Seerr, enter its address and API key, then Save and Test. No restart is needed.",
      code: "not-configured",
    },
    { status: 503 },
  );

/** Read-only authenticated check: a public status response alone cannot verify the API key. */
export async function testSeerrConnection(): Promise<{ ok: boolean; note: string }> {
  const cfg = config();
  if (!cfg)
    return {
      ok: false,
      note: "Add the Seerr address and API key in Settings → Integrations, then Save.",
    };
  try {
    const res = await fetch(`${cfg.base}/api/v1/auth/me`, {
      method: "GET",
      headers: { "X-Api-Key": cfg.key, Accept: "application/json" },
      signal: AbortSignal.timeout(8000),
      redirect: "error",
    });
    if (!res.ok)
      return {
        ok: false,
        note:
          res.status === 401 || res.status === 403
            ? "Seerr rejected the API key. Check it in Seerr settings, save the replacement here, then test again."
            : `Seerr answered HTTP ${res.status}. Check the address and API access.`,
      };
    const account = (await res.json().catch(() => null)) as { id?: unknown } | null;
    if (!account || typeof account.id !== "number")
      return {
        ok: false,
        note: "The address did not return a Seerr account. Check the Seerr base address.",
      };
    return { ok: true, note: "Connected to Seerr. API key verified." };
  } catch {
    return {
      ok: false,
      note: "Could not reach Seerr from Pixel Pals. Check its saved address and that the service is running.",
    };
  }
}

export async function handleSeerr(request: Request) {
  const cfg = config();
  if (!cfg) return notSetUp();
  const headers = { "X-Api-Key": cfg.key, Accept: "application/json" };
  try {
    if (request.method === "GET") {
      const q = new URL(request.url).searchParams.get("q")?.trim() ?? "";
      if (!q || q.length > 200)
        return Response.json({ error: "Tell me which title to look up." }, { status: 400 });
      const res = await fetch(`${cfg.base}/api/v1/search?query=${encodeURIComponent(q)}&page=1`, {
        headers,
        signal: AbortSignal.timeout(10000),
      });
      if (!res.ok) logServer("warn", `Seerr search answered ${res.status}`);
      if (!res.ok)
        return Response.json(
          { error: `Seerr answered ${res.status} — check SEERR_API_KEY.` },
          { status: 502 },
        );
      return Response.json({ results: shapeSeerr(await res.json()) });
    }
    const body = await request.json().catch(() => null);
    const mediaType = body?.mediaType;
    const mediaId = body?.mediaId;
    if ((mediaType !== "movie" && mediaType !== "tv") || !Number.isInteger(mediaId) || mediaId < 1)
      return Response.json({ error: "That request wasn't valid." }, { status: 400 });
    const payload: Record<string, unknown> = { mediaType, mediaId, is4k: body?.is4k === true };
    if (mediaType === "tv") payload["seasons"] = "all";
    const res = await fetch(`${cfg.base}/api/v1/request`, {
      method: "POST",
      headers: { ...headers, "Content-Type": "application/json" },
      body: JSON.stringify(payload),
      signal: AbortSignal.timeout(15000),
    });
    if (!res.ok) {
      logServer("warn", `Seerr request answered ${res.status}`);
      const detail = (await res.json().catch(() => null))?.message;
      return Response.json(
        { error: typeof detail === "string" ? detail : `Seerr answered ${res.status}.` },
        { status: 502 },
      );
    }
    return Response.json({ ok: true });
  } catch (error) {
    logServer("error", `Can't reach Seerr at ${cfg.base}`, error);
    return Response.json({ error: `Can't reach Seerr at ${cfg.base}.` }, { status: 502 });
  }
}

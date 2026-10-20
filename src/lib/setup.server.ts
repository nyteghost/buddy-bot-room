import { currentUser } from "./accounts.server";
import { backupConfig } from "./backup.server";
import { briefConfig } from "./brief.server";
import { calendarData, mailData } from "./inbox.server";
import { imapConfig } from "./imap.server";
import { ollamaBase } from "./ollama.server";
import { INTEGRATIONS, itemById, type SetupItem, type SetupTest } from "./setup";
import { telegramEnabled, telegramSend } from "./telegram.server";
import { unraidConfig } from "./unraid.server";
import { getWeather, weatherConfigured } from "./weather.server";

const env = (k: string) => (process.env[k] ?? "").trim().replace(/\/+$/, "");

const configured: Record<string, () => boolean> = {
  ollama: () => !!ollamaBase(),
  searxng: () => !!env("SEARXNG_URL"),
  plex: () => !!env("PLEX_URL"),
  seerr: () => !!env("SEERR_URL"),
  jellyfin: () => !!env("JELLYFIN_URL"),
  trakt: () => !!env("TRAKT_CLIENT_ID"),
  unraid: () => !!unraidConfig(),
  ntfy: () => env("NTFY_URL").startsWith("http"),
  telegram: () => telegramEnabled(),
  whisper: () => !!env("WHISPER_URL"),
  weather: () => weatherConfigured(),
  calendar: () => !!env("CALENDAR_ICS_URLS"),
  imap: () => !!imapConfig(),
  m365: () => !!env("M365_CLIENT_ID"),
  backup: () => !!backupConfig(),
  brief: () => !!briefConfig(),
};

async function reach(url: string, path = "", headers: Record<string, string> = {}): Promise<SetupTest> {
  if (!url) return { ok: false, note: "Not set up." };
  try {
    const res = await fetch(`${url}${path}`, { headers, signal: AbortSignal.timeout(5000) });
    if (res.status === 401 || res.status === 403) return { ok: false, note: "Reachable, but the key or token was refused." };
    return res.status < 500 ? { ok: true, note: "Reachable." } : { ok: false, note: `It answered with an error (HTTP ${res.status}).` };
  } catch (e) {
    return { ok: false, note: e instanceof Error && e.name === "TimeoutError" ? "No answer within 5 seconds." : "Couldn't connect. Check the address and that the service is running." };
  }
}

const tests: Record<string, () => Promise<SetupTest>> = {
  ollama: () => reach(ollamaBase(), "/api/tags"),
  searxng: () => reach(env("SEARXNG_URL")),
  plex: () => reach(env("PLEX_URL"), "/identity", env("PLEX_TOKEN") ? { "X-Plex-Token": env("PLEX_TOKEN") } : {}),
  seerr: () => reach(env("SEERR_URL"), "/api/v1/status"),
  jellyfin: () => reach(env("JELLYFIN_URL"), "/System/Ping"),
  trakt: () => reach("https://api.trakt.tv", "/movies/trending?limit=1", { "trakt-api-version": "2", "trakt-api-key": env("TRAKT_CLIENT_ID") }),
  unraid: async () => { const u = unraidConfig(); return u ? reach(u.base) : { ok: false, note: "Not set up." }; },
  ntfy: async () => {
    try {
      const res = await fetch(env("NTFY_URL"), { method: "POST", headers: { Title: "Pixel Pals test" }, body: "If you can read this, phone alerts work.", signal: AbortSignal.timeout(6000) });
      return res.ok ? { ok: true, note: "Sent. Check your phone." } : { ok: false, note: `The push service answered ${res.status}.` };
    } catch { return { ok: false, note: "Couldn't reach the push service." }; }
  },
  telegram: async () => ((await telegramSend("Pixel Pals test: if you can read this, Telegram works.")) ? { ok: true, note: "Sent. Check Telegram." } : { ok: false, note: "Couldn't send. Check TELEGRAM_BOT_TOKEN and TELEGRAM_CHAT_ID (and message the bot once first)." }),
  whisper: () => reach(env("WHISPER_URL"), "/health"),
  weather: async () => { const r = await getWeather(); return "weather" in r ? { ok: true, note: `${r.weather.place}: found.` } : { ok: false, note: r.error }; },
  calendar: async () => { const c = await calendarData(7); return c.errors.length ? { ok: false, note: c.errors[0] ?? "Failed." } : { ok: true, note: `${c.feeds} feed${c.feeds === 1 ? "" : "s"} read, ${c.items.length} event${c.items.length === 1 ? "" : "s"} in the next 7 days.` }; },
  imap: async () => { const m = await mailData(); return m.errors.length ? { ok: false, note: m.errors[0] ?? "Failed." } : { ok: true, note: `Signed in. ${m.items.length} unread.` }; },
};

/** GET lists integrations and whether each is set up; POST { id } runs one connection test. Owner only. Values are never returned. */
export async function handleSetup(request: Request): Promise<Response> {
  const user = await currentUser(request);
  if (!user?.owner) return Response.json({ error: "Only the owner account can open Setup." }, { status: 403 });
  if (request.method === "POST") {
    const body = (await request.json().catch(() => ({}))) as { id?: string };
    const item = itemById(String(body.id ?? ""));
    const run = item && tests[item.id];
    if (!item || !run) return Response.json({ ok: false, note: "Nothing to test for that one." });
    if (!configured[item.id]?.()) return Response.json({ ok: false, note: `Not set up yet. Set ${item.env} and redeploy.` });
    return Response.json(await run().catch(() => ({ ok: false, note: "The test failed unexpectedly." })));
  }
  const items: SetupItem[] = INTEGRATIONS.map((i) => ({ ...i, configured: configured[i.id]?.() ?? false }));
  return Response.json({ items });
}

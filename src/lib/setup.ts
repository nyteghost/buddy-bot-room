/** The integrations Pixel Pals can use, for the Setup window. The list and hints are public; values never leave the server. */
export type SetupItem = { id: string; name: string; what: string; env: string; configured: boolean; testable: boolean };
export type SetupTest = { ok: boolean; note: string };

export const INTEGRATIONS: { id: string; name: string; what: string; env: string; testable: boolean }[] = [
  { id: "ollama", name: "Local AI (Ollama)", what: "Answers on your own GPU", env: "OLLAMA_URL", testable: true },
  { id: "searxng", name: "Web search (SearXNG)", what: "Lets pals look things up", env: "SEARXNG_URL", testable: true },
  { id: "plex", name: "Plex", what: "Library search and what's new", env: "PLEX_URL, PLEX_TOKEN", testable: true },
  { id: "seerr", name: "Seerr", what: "Request movies and shows", env: "SEERR_URL, SEERR_API_KEY", testable: true },
  { id: "jellyfin", name: "Jellyfin", what: "Alternative media library", env: "JELLYFIN_URL", testable: true },
  { id: "trakt", name: "Trakt", what: "Watch lists and picks", env: "TRAKT_CLIENT_ID, TRAKT_USER", testable: true },
  { id: "unraid", name: "Unraid watcher", what: "Array health alerts", env: "UNRAID_URL, UNRAID_API_KEY", testable: true },
  { id: "caldav", name: "Tasks & reminders sync (iPhone)", what: "Two-way sync with the iPhone Reminders app through Radicale", env: "RADICALE_PASSWORD, COMPOSE_PROFILES=radicale", testable: true },
  { id: "ntfy", name: "Phone alerts (ntfy)", what: "Brief, reminders and alerts on your phone", env: "NTFY_URL", testable: true },
  { id: "today", name: "Today planner nudges", what: "Nudges before events and at check-ins", env: "TODAY_NUDGES, TODAY_NUDGE_LEAD, TODAY_CHECKINS", testable: false },
  { id: "telegram", name: "Telegram bot", what: "Talk to your pals from your phone", env: "TELEGRAM_BOT_TOKEN, TELEGRAM_CHAT_ID", testable: true },
  { id: "whisper", name: "Dictation (Whisper)", what: "Speak instead of typing", env: "WHISPER_URL", testable: true },
  { id: "weather", name: "Weather", what: "Forecast in Today and the brief", env: "WEATHER_LOCATION", testable: true },
  { id: "calendar", name: "Calendar feeds", what: "Calendar and Today windows", env: "CALENDAR_ICS_URLS", testable: true },
  { id: "gcal", name: "Google Calendar (shifts)", what: "Add or update your shifts in Google Calendar with one button", env: "GOOGLE_CLIENT_ID, GOOGLE_CLIENT_SECRET (or GOOGLE_SA_EMAIL, GOOGLE_SA_KEY, GOOGLE_CALENDAR_ID)", testable: true },
  { id: "github", name: "GitHub (repo watch)", what: "Watch repos in Work tools: latest commits, build status, open pull requests and issues", env: "GITHUB_TOKEN (optional)", testable: true },
  { id: "imap", name: "Mail (Gmail or any IMAP)", what: "Read, send, move and delete mail in the Mail window", env: "IMAP_HOST, IMAP_USER, IMAP_PASS", testable: true },
  { id: "m365", name: "Microsoft 365", what: "Work calendar and mail, read-only", env: "M365_CLIENT_ID", testable: false },
  { id: "backup", name: "Backups", what: "Daily copy of your data", env: "BUDDY_BACKUP_PATH", testable: false },
  { id: "brief", name: "Morning brief", what: "A daily summary and weekly review pushed to your phone", env: "BRIEF_TIME, NTFY_URL", testable: false },
  { id: "general", name: "General", what: "Time zone and update checks", env: "BUDDY_TZ", testable: false },
];

export const itemById = (id: string) => INTEGRATIONS.find((i) => i.id === id);

/** "5 of 16 set up" and what to do next. */
export function setupSummary(items: SetupItem[]): string {
  const on = items.filter((i) => i.configured).length;
  const next = items.find((i) => !i.configured);
  return `${on} of ${items.length} set up.${next ? ` Next: ${next.name} (${next.env}).` : " Everything is set up."}`;
}

/** The Settings window groups its cards under these headings, in this order. Anything not listed lands in "More" so nothing can go missing. */
export const SETUP_GROUPS: { id: string; name: string; blurb: string; ids: string[] }[] = [
  { id: "basics", name: "Basics", blurb: "Time zone, your local AI, search and dictation", ids: ["general", "ollama", "searxng", "whisper"] },
  { id: "calendar-mail", name: "Calendar & mail", blurb: "Calendar feeds, Google Calendar, email", ids: ["calendar", "gcal", "imap", "m365"] },
  { id: "phone", name: "Phone & reminders", blurb: "Alerts, Telegram, the morning brief, iPhone sync", ids: ["ntfy", "today", "telegram", "brief", "caldav"] },
  { id: "media", name: "Movies & shows", blurb: "Plex, Jellyfin, Seerr, Trakt", ids: ["plex", "jellyfin", "seerr", "trakt"] },
  { id: "home", name: "Home & server", blurb: "Weather and your Unraid server", ids: ["weather", "unraid"] },
  { id: "code", name: "Code", blurb: "GitHub repos you keep an eye on", ids: ["github"] },
  { id: "maintenance", name: "Backups & schedules", blurb: "Daily backups and scheduled tasks", ids: ["backup"] },
];

export type SetupGroupView = { id: string; name: string; blurb: string; items: SetupItem[]; on: number };
export function groupItems(items: SetupItem[]): SetupGroupView[] {
  const used = new Set<string>();
  const groups: SetupGroupView[] = SETUP_GROUPS.map((g) => {
    const mine = g.ids.flatMap((id) => { const it = items.find((i) => i.id === id); if (it) used.add(id); return it ? [it] : []; });
    return { id: g.id, name: g.name, blurb: g.blurb, items: mine, on: mine.filter((i) => i.configured).length };
  });
  const rest = items.filter((i) => !used.has(i.id));
  if (rest.length) groups.push({ id: "more", name: "More", blurb: "Everything else", items: rest, on: rest.filter((i) => i.configured).length });
  return groups.filter((g) => g.items.length || g.id === "maintenance");
}

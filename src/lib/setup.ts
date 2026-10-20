/** The integrations Pixel Pals can use, for the Setup window. The list and hints are public; values never leave the server. */
export type SetupItem = { id: string; name: string; what: string; env: string; configured: boolean; testable: boolean };
export type SetupTest = { ok: boolean; note: string };

export const INTEGRATIONS: { id: string; name: string; what: string; env: string; testable: boolean }[] = [
  { id: "ollama", name: "Local AI (Ollama)", what: "Answers on your own GPU", env: "OLLAMA_URL (set by the stack)", testable: true },
  { id: "searxng", name: "Web search (SearXNG)", what: "Lets pals look things up", env: "SEARXNG_URL", testable: true },
  { id: "plex", name: "Plex", what: "Library search and what's new", env: "PLEX_URL, PLEX_TOKEN", testable: true },
  { id: "seerr", name: "Seerr", what: "Request movies and shows", env: "SEERR_URL, SEERR_API_KEY", testable: true },
  { id: "jellyfin", name: "Jellyfin", what: "Alternative media library", env: "JELLYFIN_URL", testable: true },
  { id: "trakt", name: "Trakt", what: "Watch lists and picks", env: "TRAKT_CLIENT_ID, TRAKT_USER", testable: true },
  { id: "unraid", name: "Unraid watcher", what: "Array health alerts", env: "UNRAID_URL, UNRAID_API_KEY", testable: true },
  { id: "caldav", name: "Tasks & reminders sync (iPhone)", what: "Two-way sync with the iPhone Reminders app through Radicale", env: "RADICALE_PASSWORD, COMPOSE_PROFILES=radicale", testable: true },
  { id: "ntfy", name: "Phone alerts (ntfy)", what: "Brief, reminders and alerts on your phone", env: "NTFY_URL", testable: true },
  { id: "telegram", name: "Telegram bot", what: "Talk to your pals from your phone", env: "TELEGRAM_BOT_TOKEN, TELEGRAM_CHAT_ID", testable: true },
  { id: "whisper", name: "Dictation (Whisper)", what: "Speak instead of typing", env: "WHISPER_URL", testable: true },
  { id: "weather", name: "Weather", what: "Forecast in Today and the brief", env: "WEATHER_LOCATION", testable: true },
  { id: "calendar", name: "Calendar feeds", what: "Calendar and Today windows", env: "CALENDAR_ICS_URLS", testable: true },
  { id: "imap", name: "Mail (IMAP)", what: "Unread subjects in Mail", env: "IMAP_HOST, IMAP_USER, IMAP_PASS", testable: true },
  { id: "m365", name: "Microsoft 365", what: "Work calendar and mail, read-only", env: "M365_CLIENT_ID", testable: false },
  { id: "backup", name: "Backups", what: "Daily copy of your data", env: "BUDDY_BACKUP_PATH", testable: false },
  { id: "brief", name: "Morning brief", what: "A daily summary pushed to your phone", env: "BRIEF_TIME, NTFY_URL", testable: false },
];

export const itemById = (id: string) => INTEGRATIONS.find((i) => i.id === id);

/** "5 of 16 set up" and what to do next. */
export function setupSummary(items: SetupItem[]): string {
  const on = items.filter((i) => i.configured).length;
  const next = items.find((i) => !i.configured);
  return `${on} of ${items.length} set up.${next ? ` Next: ${next.name} (${next.env}).` : " Everything is set up."}`;
}

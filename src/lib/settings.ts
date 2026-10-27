/**
 * Settings you can change inside the app (Settings window) instead of in the stack's environment file.
 * Pure helpers and the field list; the file handling is in settings.server.ts.
 *
 * Rule: a value saved here wins over the same value in the stack's environment (which stays as the fallback);
 * clearing it goes back to the environment value. Things the stack itself needs before the app starts
 * (COMPOSE_PROFILES, Tailscale, Radicale's password, the Ollama runtime, accounts) stay in Portainer.
 */
export type SettingKind = "text" | "url" | "select" | "time" | "number" | "list";
export type SettingField = {
  key: string;
  label: string;
  /** Matches an id in INTEGRATIONS (setup.ts). */
  group: string;
  /** Kept in a separate file that backups skip, and never sent back to the browser. */
  secret?: boolean;
  kind: SettingKind;
  placeholder?: string;
  options?: string[];
  help?: string;
};

export const SETTING_FIELDS: SettingField[] = [
  { key: "OLLAMA_URL", label: "Ollama address", group: "ollama", kind: "url", placeholder: "http://10.200.1.50:11434", help: "Where your Ollama runs: the ollama container (http://ollama:11434) or another machine, such as the PC with the RTX 3080. That machine's Ollama must listen on the network (OLLAMA_HOST=0.0.0.0)." },
  { key: "LOCAL_ONLY_AI", label: "Local-Only AI (no paid or cloud AI)", group: "ollama", kind: "select", options: ["on", "off"], help: "On: every answer, scheduled job and retry uses only your own Ollama. Free and paid cloud keys are never called, even if saved. Off (the default): the engine you pick in AI engine settings is used, including free cloud keys. Paid engines never run unattended either way." },
  { key: "OBSIDIAN_VAULT_DIR", label: "Obsidian vault folder", group: "obsidian", kind: "text", placeholder: "/vault", help: "Where your Obsidian vault is mounted inside the Pixel Pals container (add a volume like /mnt/user/appdata/obsidian/vaults/Homelab:/vault, read-write). The Notes tab can then open, edit and add vault notes." },
  { key: "OBSIDIAN_NEW_FOLDER", label: "Folder for new notes", group: "obsidian", kind: "text", placeholder: "Pixel Pals", help: "Notes created from Pixel Pals go in this vault folder. Leave empty for the vault's top level." },
  { key: "PLEX_URL", label: "Plex address", group: "plex", kind: "url", placeholder: "http://10.0.0.5:32400" },
  { key: "PLEX_TOKEN", label: "Plex token", group: "plex", kind: "text", secret: true },
  { key: "SEERR_URL", label: "Seerr address", group: "seerr", kind: "url", placeholder: "http://10.0.0.5:5055" },
  { key: "SEERR_API_KEY", label: "Seerr API key", group: "seerr", kind: "text", secret: true },
  { key: "JELLYFIN_URL", label: "Jellyfin address", group: "jellyfin", kind: "url", placeholder: "http://10.0.0.5:8096" },
  { key: "TRAKT_CLIENT_ID", label: "Trakt client ID", group: "trakt", kind: "text" },
  { key: "TRAKT_USER", label: "Trakt username", group: "trakt", kind: "text" },
  { key: "TRAKT_LIST", label: "Trakt list", group: "trakt", kind: "text", placeholder: "watchlist", help: "The list's name or slug. Leave empty for your watchlist." },
  { key: "TRAKT_CLIENT_SECRET", label: "Trakt client secret", group: "trakt", kind: "text", secret: true, help: "Only needed to add titles to your list." },
  { key: "TRAKT_ACCESS_TOKEN", label: "Trakt access token", group: "trakt", kind: "text", secret: true, help: "Only needed for a private list." },
  { key: "UNRAID_URL", label: "Unraid address", group: "unraid", kind: "url", placeholder: "http://10.0.0.5" },
  { key: "UNRAID_API_KEY", label: "Unraid API key", group: "unraid", kind: "text", secret: true },
  { key: "UNRAID_CHECK_SECONDS", label: "Check every (seconds)", group: "unraid", kind: "number", placeholder: "60" },
  { key: "TODAY_NUDGES", label: "Today nudges", group: "today", kind: "select", options: ["on", "off"], help: "Push a nudge before calendar events and at check-in times, over your phone alerts." },
  { key: "TODAY_NUDGE_LEAD", label: "Minutes before an event", group: "today", kind: "number", placeholder: "10" },
  { key: "TODAY_CHECKINS", label: "Check-in times", group: "today", kind: "text", placeholder: "12:00, 15:30", help: "24-hour times, separated by commas." },
  { key: "NTFY_URL", label: "ntfy topic link", group: "ntfy", kind: "url", secret: true, placeholder: "https://ntfy.sh/your-private-topic", help: "Treat it like a password: anyone with the link can post to your phone." },
  { key: "TELEGRAM_BOT_TOKEN", label: "Telegram bot token", group: "telegram", kind: "text", secret: true },
  { key: "TELEGRAM_CHAT_ID", label: "Your Telegram chat ID", group: "telegram", kind: "text", help: "Only this chat can talk to the bot." },
  { key: "WEATHER_LOCATION", label: "Place", group: "weather", kind: "text", placeholder: "Atlanta, GA" },
  { key: "WEATHER_UNITS", label: "Units", group: "weather", kind: "select", options: ["imperial", "metric"] },
  { key: "CALENDAR_ICS_URLS", label: "Calendar feed links", group: "calendar", kind: "list", secret: true, placeholder: "https://…/basic.ics", help: "Google, iCloud, Outlook or Cozi share links (webcal:// links work too). Up to six, separated by spaces or commas. Private feed links work like passwords." },
  { key: "GOOGLE_CLIENT_ID", label: "Google client ID", group: "gcal", kind: "text", help: "From Google Cloud Console → Credentials → OAuth client (Web application). Lets Pixel Pals add your shifts to Google Calendar." },
  { key: "GOOGLE_CLIENT_SECRET", label: "Google client secret", group: "gcal", kind: "text", secret: true },
  { key: "GOOGLE_SA_EMAIL", label: "Service account email (optional)", group: "gcal", kind: "text", placeholder: "pixel-pals@your-project.iam.gserviceaccount.com", help: "Never-expiring alternative to signing in. Share your calendar with this address (Make changes to events)." },
  { key: "GOOGLE_SA_KEY", label: "Service account private key", group: "gcal", kind: "text", secret: true, help: "Paste the private_key value from the downloaded JSON key file (the long text between the quotes)." },
  { key: "GOOGLE_CALENDAR_ID", label: "Calendar to use", group: "gcal", kind: "text", placeholder: "you@gmail.com", help: "Your calendar's ID: for your main Google calendar this is your Gmail address. Needed with the service account." },
  { key: "GITHUB_TOKEN", label: "GitHub token (optional)", group: "github", kind: "text", secret: true, help: "Repos are watched read-only. Public repos work without this; add a token for private repos or a higher hourly limit. Create a fine-grained token at github.com/settings/tokens with read access to Contents, Actions, Pull requests and Issues." },
  { key: "IMAP_HOST", label: "Mail server (IMAP)", group: "imap", kind: "text", placeholder: "imap.gmail.com", help: "Gmail: imap.gmail.com. Outlook.com: outlook.office365.com. iCloud: imap.mail.me.com. Fastmail: imap.fastmail.com." },
  { key: "IMAP_PORT", label: "Port", group: "imap", kind: "number", placeholder: "993" },
  { key: "IMAP_USER", label: "Email address", group: "imap", kind: "text", placeholder: "you@gmail.com", help: "Your full address. Sending needs it." },
  { key: "IMAP_PASS", label: "App password", group: "imap", kind: "text", secret: true, help: "Not your normal password. Gmail: turn on 2-Step Verification, then create a 16-character app password at myaccount.google.com/apppasswords." },
  { key: "SMTP_HOST", label: "Sending server (SMTP)", group: "imap", kind: "text", placeholder: "smtp.gmail.com", help: "Leave empty to use the usual name (imap.gmail.com becomes smtp.gmail.com)." },
  { key: "SMTP_PORT", label: "Sending port", group: "imap", kind: "number", placeholder: "465", help: "465 (encrypted straight away) or 587 (upgrades with STARTTLS)." },
  { key: "MAIL_FROM_NAME", label: "Your name on sent mail", group: "imap", kind: "text", placeholder: "Chelli" },
  { key: "M365_CLIENT_ID", label: "Microsoft app (client) ID", group: "m365", kind: "text" },
  { key: "M365_TENANT", label: "Tenant", group: "m365", kind: "text", placeholder: "organizations" },
  { key: "BRIEF_TIME", label: "Brief time (24-hour)", group: "brief", kind: "time", placeholder: "07:30" },
  { key: "REVIEW_DAY", label: "Weekly review day", group: "brief", kind: "select", options: ["sun", "mon", "tue", "wed", "thu", "fri", "sat"] },
  { key: "REVIEW_TIME", label: "Weekly review time", group: "brief", kind: "time", placeholder: "18:00" },
  { key: "BUDDY_BACKUP_TIME", label: "Backup time (24-hour)", group: "backup", kind: "time", placeholder: "03:30" },
  { key: "BUDDY_BACKUP_KEEP", label: "Backups to keep", group: "backup", kind: "number", placeholder: "7" },
  { key: "BUDDY_TZ", label: "Time zone", group: "general", kind: "text", placeholder: "America/New_York", help: "Used for the brief, reminders and backups." },
  { key: "UPDATE_CHECK", label: "Check GitHub for updates", group: "general", kind: "select", options: ["on", "off"] },
];

export const fieldByKey = (key: string): SettingField | undefined => SETTING_FIELDS.find((f) => f.key === key);
export const fieldsFor = (group: string): SettingField[] => SETTING_FIELDS.filter((f) => f.group === group);

const MAX = 2000;

/** Tidy and check one value. Surrounding quotes are dropped (a Portainer habit that breaks lookups). */
export function cleanSetting(field: SettingField, raw: unknown): { ok: true; value: string } | { ok: false; error: string } {
  let v = String(raw ?? "").replace(/[\r\n\t]+/g, " ").trim();
  if (/^(["']).*\1$/.test(v)) v = v.slice(1, -1).trim();
  if (v.length > MAX) return { ok: false, error: `${field.label} is too long.` };
  if (!v) return { ok: true, value: "" };
  switch (field.kind) {
    case "url": {
      try { const p = new URL(v).protocol; if (p !== "http:" && p !== "https:") throw new Error("scheme"); } catch { return { ok: false, error: `${field.label} must be a full link starting with http:// or https://.` }; }
      return { ok: true, value: v.replace(/\/+$/, "") };
    }
    case "list": {
      const parts = v.split(/[\s,]+/).filter(Boolean).map((u) => u.replace(/^webcal:/i, "https:"));
      if (parts.length > 6) return { ok: false, error: `${field.label}: six links at most.` };
      if (!parts.every((p) => /^https?:\/\//i.test(p))) return { ok: false, error: `${field.label}: every link must start with http:// or https://.` };
      return { ok: true, value: parts.join(",") };
    }
    case "time": {
      const m = /^(\d{1,2}):(\d{2})$/.exec(v);
      if (!m || Number(m[1]) > 23 || Number(m[2]) > 59) return { ok: false, error: `${field.label} must look like 07:30 (24-hour).` };
      return { ok: true, value: `${String(Number(m[1])).padStart(2, "0")}:${m[2]}` };
    }
    case "number": {
      const n = Number(v);
      if (!Number.isFinite(n) || n <= 0 || n > 100000) return { ok: false, error: `${field.label} must be a positive number.` };
      return { ok: true, value: String(Math.round(n)) };
    }
    case "select": {
      const lower = v.toLowerCase();
      const hit = field.options?.find((o) => o === lower);
      if (!hit) return { ok: false, error: `${field.label} must be one of: ${field.options?.join(", ")}.` };
      return { ok: true, value: hit };
    }
    default:
      return { ok: true, value: v };
  }
}

/** The environment value the rest of the app reads, for a stored setting ("on"/"off" become what UPDATE_CHECK expects). */
export function envValue(key: string, stored: string): string {
  if (key === "UPDATE_CHECK") return stored === "off" ? "0" : "1";
  return stored;
}

export type SettingState = {
  key: string;
  label: string;
  group: string;
  kind: SettingKind;
  secret: boolean;
  options?: string[] | undefined;
  placeholder?: string | undefined;
  help?: string | undefined;
  /** "env": only the stack has it (editable here, which overrides it). "app": saved here. "none": not set. */
  source: "env" | "app" | "none";
  /** Only for non-secret values saved here. Secrets and Portainer values are never sent. */
  value?: string | undefined;
};

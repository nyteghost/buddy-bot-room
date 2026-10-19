# Pixel Pals — Buddy Bot Room

A multi-model AI chat room where a cast of pixel-art characters discuss whatever you give them. Pick a topic, choose a conversation mode, hit start, and watch the pals walk around their office, sit at their desks and talk it out.

**Live app:** https://buddy-bot-room.lovable.app

---

## Features

### The room
- **Seven pixel pals** with 128×128 hand-drawn sprites that walk, sit at desks and act out tasks.
- **Themes** — swap the whole cast (names, looks, personalities): Linux, Dungeon Crawler Carl, horror, cyberpunk and more.
- **Conversation modes** — Roundtable, Broadcast, One-on-one and Problem solving.
- **@mentions** — talk to one pal directly (`@calendar`, `@gmail`, `@notes`, `@system`, `@terminal`, …).
- **Assistant Mode** — a switch that turns any cast into office helpers, keeping their names and voices.

### AI engines
- **Lovable AI** (default, no setup).
- **Free keys** — Groq, Gemini, OpenRouter, NVIDIA NIM. Keys travel per request and are never stored on the server (signed-in users get them encrypted).
- **WebGPU** — runs a small model right in your browser.
- **Ollama** — your local or remote (Tailscale / Cloudflare Tunnel) server.
- **Auto** — tries free keys first, then falls back to WebGPU or Ollama.

### Quality-of-life (inspired by Odysseus)
- **Slash commands** — `/help`, `/mode`, `/rounds`, `/theme`, `/assistant`, `/clear`, `/stop`, `/export`, `/record`, `/confetti`, with a Tab-complete menu.
- **↑ / ↓ prompt recall** — shell-style history in the composer; never hijacks a draft you're typing.
- **Hidden thinking** — `<think>…</think>` from reasoning models (qwen3, deepseek-r1…) is filtered out live, and they get a bigger token budget so answers aren't cut off.
- **Emoji shortcodes** — `:fire:` becomes 🔥 in replies (code blocks untouched).
- **Confetti** when a Problem-solving discussion reaches its verdict.
- **Compare models** — `/compare` (or the sidebar button) sends one question to 2–3 of your engines/Ollama models with the names hidden; you vote, then see who wrote what. A win/loss scoreboard is kept in your browser.
- **Pal memory** — `/remember <fact>`, `/memories`, `/forget <n|all>`. Every pal sees what you asked them to remember.
- **Notes & to-dos** — `/note`, `/todo`, `/done <n>`, `/tasks`, plus a *Notes & tasks* window. Open to-dos are shared with the pals.
- **Web search** — `/search <query>` shows results; `/research <question>` hands them to the pals to discuss (needs a SearXNG, see [self-hosting](docs/SELF_HOSTING.md)).
- **@seerr** — `@seerr Dune Part Two 4k` looks the title up in Seerr and asks you to confirm before requesting (needs `SEERR_URL` / `SEERR_API_KEY` on the server).
- **Local-model polish** — installed Ollama models appear in a dropdown, with a reply-length setting; copy a reply or edit-and-resend your own message.
- **Self-hosting** — `docker compose up -d --build`, see [docs/SELF_HOSTING.md](docs/SELF_HOSTING.md).

### Saved discussions
- Multiple chats with auto-save and a slide-out history.
- On the Lovable-hosted app, optional Google sign-in syncs chats, theme and engine settings across devices. In the Docker build, use the built-in accounts instead (see below). Signed out, everything stays in the browser.

### Work tools (Show Services)
All run in the browser — files never leave your device.
- **Events** — drop one or more Ungerboeck / "For Scheduling" PDFs (plus an optional monthly .xlsx) to get a weekly engineering schedule in Excel: halls, ballrooms, escalator and service-desk rows, merged cells for multi-room events, and color coding (green move-in, yellow show, orange move-out, teal move-in+show, blue all three). Existing engineer shifts are preserved.
- **My shifts** — paste or upload your schedule, download an .ics, or push every shift to your own Google Calendar.
- **Deck** — `@deck 24x24x32` plans stage decks and stairs, with a link to Deck Builder Pro.
- **Vendors** — `@price` / `@gear` builds search links for Grainger, McMaster-Carr, Home Depot and 1000bulbs with tax-exempt notes.

### Recorder
- **Record** button (or `@record` / `@mic`) opens Echo's recorder. Recording starts only when you press it.
- Long recordings split automatically into 14-minute parts.
- **Transcribe** labels speakers (Man 1, Woman 1, …). Audio is sent only when you tap Transcribe.

### Linux desktop app
A Tauri build (`.AppImage`) adds a real terminal, system stats, notes, file listing and self-update. Pals can suggest commands, but **nothing runs without your click**. See [`packaging/README.md`](packaging/README.md).

---

## Self-hosting with Docker (everything below needs this)

```sh
git clone https://github.com/nyteghost/buddy-bot-room ~/buddy-bot-room && cd ~/buddy-bot-room
cp .env.local.example .env.local     # optional: put the settings from the table below here
docker compose up -d --build         # then open http://<this-machine>:8090
```

Portainer: *Stacks → Add stack → Repository*, compose path `docker-compose.portainer.yml`, add the variables you want, deploy. Update with *Pull and redeploy* (or `git pull && docker compose up -d --build`). Full details: [docs/SELF_HOSTING.md](docs/SELF_HOSTING.md).

### Accounts and settings
- **First visit:** create a username and password. That account is the **owner**. Do this right after deploying; until then anyone who reaches the page could. Setting `BUDDY_PASSWORD` makes it a *setup password* the form asks for.
- **Add people:** your name (top bar) → *Accounts* → add a username and password. Owners can also reset or remove accounts; everyone can change their own password.
- **Everything follows you:** engine settings, API keys, theme, presets, pal memories, to-dos, documents, Dungeon Master campaign and layout sync to your account on every device. Last change wins.
- **Chats are private** to each account. Click the share icon on a chat in the Chats list to share it with everyone who has an account.
- **Forgot the owner password?** Stop the stack, delete `users.json` from the `buddy-data` volume, start, and create a new owner. `BUDDY_ACCOUNTS=0` turns accounts off.
- **Phone / HTTPS:** on the host run `sudo tailscale serve --bg --https=443 http://localhost:8090`, then use `https://<machine>.<tailnet>.ts.net` on your devices.

### Handy built-ins
- **Command palette** Ctrl+K, **debug log** Ctrl+Shift+L (or `/log`; *Copy report* and paste it to Claude), **health** at `/__health`.
- **Settings export/import:** Ctrl+K → *Export settings* / *Import settings*.
- **Dungeon Master:** `/dm start <premise>`, `/roll d20`, `/roll 2d6+3`, `/roll d20 adv`, `/dm character|fact <text>`, `/dm status`, `/dm end`.
- **Voice replies:** the *Voice* button or `/voice` reads replies aloud in a different voice per pal; the speaker button reads one reply. Off by default.
- **Install on iPhone:** Safari → Share → *Add to Home Screen* (needs the HTTPS address). A Shortcut that opens `https://<address>/?q=<text>` puts shared text in the message box.

### Media: Plex, Trakt, Jellyfin, Seerr
- **Plex** (`PLEX_URL`, `PLEX_TOKEN`): `/plex <title>`, `/plex recent`, `/watch [mood]`. The token is the `X-Plex-Token=` value in an item's *Get Info → View XML* address.
- **Trakt** (`TRAKT_CLIENT_ID`, `TRAKT_USER`, optional `TRAKT_LIST`, `TRAKT_ACCESS_TOKEN` for private lists): create an app at trakt.tv → Settings → Your API Apps and copy its Client ID. `/trakt lists`, `/trakt <list>`, `/next [list:name] [mood]` have the pals pick from the list, marking each item **in Plex** or not.
- **Seerr** (`SEERR_URL`, `SEERR_API_KEY`): `@seerr Dune 4k` or `/request <title>` opens a confirm dialog.
- **Jellyfin** (`JELLYFIN_URL`, `JELLYFIN_API_KEY`): `/library <title>` or `/library recent`.
- **Web search** (`SEARXNG_URL`): `/search`, `/research`.

### Unraid watcher and phone alerts
Set `UNRAID_URL` and `UNRAID_API_KEY` (read-only key is fine). Red/amber banners appear when Unraid is unreachable or unhealthy; `/server` shows status and `/diagnose` asks the pals for advice. For phone pushes install the free **ntfy** app, subscribe to a long random topic and set `NTFY_URL=https://ntfy.sh/<topic>` (no need to host it on Unraid).

### Morning brief
Set `BRIEF_TIME` (e.g. `08:00`) and `NTFY_URL`. You get one push with Unraid health, last backup, tonight's Trakt pick (preferring what's in Plex) and what's new in Plex. `/brief` previews it, `/brief send` pushes it now.

### Nightly backup
Pixel Pals copies its data folder to `/backups` at `BUDDY_BACKUP_TIME` (default 03:30) and keeps `BUDDY_BACKUP_KEEP` copies (default 14). `/backup` shows status, `/backup now` runs one (owner). To keep backups off the machine, mount an Unraid share and set `BUDDY_BACKUP_PATH=/mnt/unraid/pixelpals-backups`. Restore by stopping the stack and copying a backup folder back into the `buddy-data` volume.

### Sync an iPhone Note with Trakt
Read-only on Trakt: watched movies get ✓, started shows ▶, your own marks are never removed. Create an access token (Accounts → *iPhone Shortcut access token*), then build a Shortcut: **Find Notes** → **Get Details of Notes (Body)** → **Get Contents of URL** `POST https://<address>/api/notes-sync?format=report&skip=1` with headers `Authorization: Bearer <token>`, `Content-Type: text/plain` and the body as the request body → **Show Result**. Use `format=note` for the whole note with marks added. Details in [docs/SELF_HOSTING.md](docs/SELF_HOSTING.md).

### Settings reference
| Variable | Purpose |
|---|---|
| `BUDDY_PORT` | Port (default 8090) |
| `BUDDY_PASSWORD` | Setup password for the first account (or the shared gate if `BUDDY_ACCOUNTS=0`) |
| `BUDDY_ACCOUNTS` | `0` turns built-in accounts off |
| `BUDDY_TZ` | Time zone for schedules (default America/New_York) |
| `SEARXNG_URL`, `SEERR_URL`, `SEERR_API_KEY` | Search and requests |
| `PLEX_URL`, `PLEX_TOKEN`, `JELLYFIN_URL`, `JELLYFIN_API_KEY` | Media libraries |
| `TRAKT_CLIENT_ID`, `TRAKT_USER`, `TRAKT_LIST`, `TRAKT_ACCESS_TOKEN` | Trakt |
| `UNRAID_URL`, `UNRAID_API_KEY`, `UNRAID_CHECK_SECONDS` | Unraid watcher |
| `NTFY_URL`, `BRIEF_TIME` | Phone pushes and morning brief |
| `BUDDY_BACKUP_PATH`, `BUDDY_BACKUP_TIME`, `BUDDY_BACKUP_KEEP` | Backups |

## Tech stack

- [TanStack Start](https://tanstack.com/start) (React 19, Vite 7, SSR on Cloudflare Workers)
- Tailwind CSS v4 + shadcn/ui + AI Elements
- Lovable Cloud (auth, database) and Lovable AI Gateway
- Tauri for the desktop build
- exceljs / xlsx / pdf.js for the work tools

## Getting started

Requires Node.js 20+ (or Bun).

```sh
git clone <this-repository-url>
cd <repository-name>
bun install      # or npm i
bun run dev      # http://localhost:8080
```

Run tests:

```sh
bunx vitest run
```

### Using a local Ollama

```sh
OLLAMA_ORIGINS="*" ollama serve
ollama pull qwen2.5-coder:7b
```

Then pick **Ollama** (or **Auto**) in the AI engine menu.

## Project layout

```text
src/
  routes/          pages and server routes (/api/chat, /api/transcribe, …)
  components/      room, pals, work tools, recorder, terminal
  lib/             agents, themes, engines, work-tools, deck solver
  test/            vitest suites
src-tauri/         desktop (Linux) app
packaging/         install scripts and desktop build notes
```

See [`AGENTS.md`](AGENTS.md) for architecture rules.

## Privacy

- Work tool files are processed entirely in your browser.
- Microphone and machine actions only happen after you click.
- Free-engine keys are never stored server-side in plain text.

---

Built with [Lovable](https://lovable.dev) — keep editing in the [Lovable editor](https://lovable.dev/projects/12804d65-d2a1-4f59-8779-f480d1faa8f1). Changes sync both ways with GitHub.

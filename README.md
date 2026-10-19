<div align="center">

# Pixel Pals · Buddy Bot Room

**A multi-model AI chat room where a cast of pixel-art characters talk your topic through, and an optional self-hosted hub for your Plex, Trakt, Seerr, Unraid and iPhone Notes.**

[Live app](https://buddy-bot-room.lovable.app) · [Self-hosting guide](docs/SELF_HOSTING.md) · [Architecture rules](AGENTS.md)

</div>

---

## Table of contents

1. [What is Pixel Pals?](#1-what-is-pixel-pals)
2. [Quick start](#2-quick-start)
   - [Docker (recommended)](#docker-recommended) · [Portainer](#portainer) · [Without Docker](#without-docker) · [Updating](#updating)
3. [First run: accounts and HTTPS](#3-first-run-accounts-and-https)
4. [The room](#4-the-room)
5. [AI engines and API keys](#5-ai-engines-and-api-keys)
6. [Slash commands, shortcuts and the command palette](#6-slash-commands-shortcuts-and-the-command-palette)
7. [Connecting other things](#7-connecting-other-things)
   - [Web search (SearXNG)](#71-web-search-searxng) · [Seerr](#72-seerr-requests) · [Plex](#73-plex) · [Trakt](#74-trakt) · [Jellyfin](#75-jellyfin) · [Unraid watcher](#76-unraid-watcher) · [ntfy phone alerts](#77-ntfy-phone-alerts) · [iPhone Notes ↔ Trakt](#78-iphone-notes--trakt-sync) · [iPhone share sheet](#79-iphone-share-sheet)
8. [Automatic jobs](#8-automatic-jobs): [Morning brief](#81-morning-brief) · [Nightly backup](#82-nightly-backup)
9. [Accounts, sharing and saved settings](#9-accounts-sharing-and-saved-settings)
10. [Using it on your phone](#10-using-it-on-your-phone)
11. [Dungeon Master mode](#11-dungeon-master-mode)
12. [Voice replies](#12-voice-replies)
13. [Work tools and the recorder](#13-work-tools-and-the-recorder)
14. [Configuration reference](#14-configuration-reference)
15. [Troubleshooting](#15-troubleshooting)
16. [Security notes](#16-security-notes)
17. [Development](#17-development)

---

## 1. What is Pixel Pals?

Pick a topic, choose a conversation mode, and watch seven pixel pals walk around their office, sit at desks and talk it out. Each pal runs on whichever AI engine you choose.

There are two ways to run it:

| | Lovable-hosted app | Self-hosted (Docker) |
|---|---|---|
| Where | https://buddy-bot-room.lovable.app | Your own server or PC |
| Sign-in | Optional Google sign-in | Built-in accounts (no outside service) |
| Plex / Trakt / Seerr / Unraid / backups / brief | Not available | Yes (everything in section 7 and 8) |
| Default AI | Lovable AI | Ollama or your own free API keys |

Everything from section 2 onward is about the **self-hosted** build unless noted.

---

## 2. Quick start

### Docker (recommended)

```sh
git clone https://github.com/nyteghost/buddy-bot-room ~/buddy-bot-room
cd ~/buddy-bot-room
cp .env.local.example .env.local      # optional: fill in the services you use
docker compose up -d --build
```

Open `http://<this-machine>:8090`. Change the port with `BUDDY_PORT=9000 docker compose up -d`.

### Portainer

1. **Stacks → Add stack → Repository.**
2. Repository URL `https://github.com/nyteghost/buddy-bot-room`, reference `refs/heads/main` (add a GitHub token under *Authentication* if the repo is private).
3. **Compose path:** `docker-compose.portainer.yml`.
4. Add **Environment variables** for whatever you want to connect (see [section 14](#14-configuration-reference)).
5. **Deploy the stack**, then open `http://<host>:8090`.

Newer Portainer versions ask for a **Source** first: choose *Create new source*, name it, enter the repository URL, and add a token only if the repo is private.

### Without Docker

```sh
bun install
bun run dev --host 0.0.0.0 --port 8090
```

Put the same variables in `.env.local` (Bun loads it automatically). Server-side features that store data (accounts, backups, shared chats) need `BUDDY_DATA_DIR` set to a writable folder.

### Updating

- Docker: `git pull && docker compose up -d --build`
- Portainer: open the stack and press **Pull and redeploy**. The compose file rebuilds the image.

Your data lives in the `buddy-data` volume and survives updates.

---

## 3. First run: accounts and HTTPS

1. **Create your account right after deploying.** The first visit shows *Create your account*. That account becomes the **owner**. Until it exists, whoever reaches the page first could create it. If you set `BUDDY_PASSWORD`, it acts as a *setup password* the form asks for.
2. After that, the page shows *Sign in*. There is no sign-up button by design; the owner adds people (see [section 9](#9-accounts-sharing-and-saved-settings)).
3. **HTTPS (recommended, needed for phone install and notifications).** With Tailscale on the host:
   ```sh
   sudo tailscale serve --bg --https=443 http://localhost:8090
   ```
   Then use `https://<machine>.<your-tailnet>.ts.net` on every device. Browsers only allow notifications and some PWA features on HTTPS or localhost.

---

## 4. The room

- **Seven pixel pals** with hand-drawn 128×128 sprites that walk, sit at desks and act out tasks.
- **Themes** swap the entire cast (names, looks, personalities, room): Normal, Hellraiser, Horror, Matrix, Final Fantasy, Dev Team, Cyberpunk, Dungeon Crawler Carl and Linux.
- **Conversation modes:**
  - *Roundtable*: pals respond to each other.
  - *Broadcast*: independent answers.
  - *One-on-one*: talk to a single pal.
  - *Problem solving*: pals debate and deliver a verdict (with confetti).
- **Rounds**: how many times the pals go around (1–5).
- **@mentions** talk to one pal directly: `@calendar`, `@gmail`, `@notes`, `@system`, `@terminal`, `@deck`, `@price`, `@gear`, `@seerr`, `@record`.
- **Assistant Mode** turns any cast into office helpers while keeping their names and voices.
- **Chat niceties:** ↑/↓ prompt recall, hidden `<think>` blocks from reasoning models, emoji shortcodes (`:fire:` → 🔥), copy a reply, edit and resend your own message, regenerate, branch a conversation.
- **Saved chats:** auto-saved, searchable, renameable, pinnable (per browser). Self-hosted chats are stored on the server and are private per account (see [section 9](#9-accounts-sharing-and-saved-settings)).
- **Compare models** (`/compare`): sends one question to 2–3 engines with the names hidden. You vote, then see who wrote what; a scoreboard is kept in your browser.
- **Pal memory, notes and to-dos:** everything in the *Notes & tasks* window. Open to-dos and memories are shared with every pal. You can also attach **documents** that the pals use as reference.
- **Presets and settings export/import:** Ctrl+K → *Export settings* / *Import settings*. Exports leave API keys out unless you choose "including API keys".

---

## 5. AI engines and API keys

Open **Free keys** (or *AI engine*) in the top bar. Pick one engine or let **Auto** try several.

| Engine | Where to get it | Notes |
|---|---|---|
| **Lovable AI** | Built in | Only works on Lovable's hosting, not self-hosted |
| **Groq** | https://console.groq.com/keys | Free tier, very fast |
| **Gemini** | https://aistudio.google.com/app/apikey | Free tier |
| **OpenRouter** | https://openrouter.ai/keys | Has free models |
| **NVIDIA NIM** | https://build.nvidia.com | Free credits |
| **Ollama** | Your own machine | No key; fully local |
| **WebGPU** | Runs in your browser | Small model, nothing leaves the device |
| **Auto** | | Free keys first, then WebGPU or Ollama |

Keys are sent with each request and never stored in plain text server-side. On the Docker build, with accounts on, your keys sync to your account on the server (the `buddy-data` volume, not encrypted) so every device has them.

### Get free keys (guided)

In **Free keys** (engine settings) the **Get free keys** panel walks you through it. Pixel Pals can't create the keys for you, because each provider requires you to sign in on their site. For each provider:

1. Tap **Open key page** and create a key there.
2. Copy it, come back, and either paste it into **Paste a key here** or tap **Add from clipboard**. The provider is recognised from the key's prefix (`gsk_` Groq, `AIza` Gemini, `sk-or-` OpenRouter, `nvapi-` NVIDIA) and saved in the right slot.
3. It is tested automatically (one free "list models" request from the server). Tap **Test** any time to re-check. A green tick means the key works.

### Setting up Ollama

```sh
OLLAMA_ORIGINS="*" OLLAMA_HOST=0.0.0.0 ollama serve
ollama pull qwen2.5-coder:7b
```

Ollama is called by **your browser**, so the URL in engine settings must be reachable from the device you browse on (for example `http://<pc-ip>:11434` or a Tailscale address). Installed models appear in a dropdown, and there is a reply-length setting for small models.

---

## 6. Slash commands, shortcuts and the command palette

Type `/` for an autocomplete menu (Tab completes). `Ctrl+K` opens the command palette.

| Command | What it does |
|---|---|
| `/help` | List every command |
| `/mode <roundtable\|broadcast\|direct\|solve>` | Switch conversation mode |
| `/rounds <1-5>` | Rounds the pals debate |
| `/theme <name>` | Swap the cast |
| `/assistant [on\|off]` | Assistant Mode |
| `/clear` · `/stop` · `/export` | New chat · stop · download as Markdown |
| `/record` | Open the recorder |
| `/confetti` | Celebrate |
| `/remember <fact>` · `/memories` · `/forget <n\|all>` | Pal memory |
| `/note <text>` · `/todo <task>` · `/done <n>` · `/tasks` | Notes and to-dos |
| `/search <query>` · `/research <question>` | Web search · search then discuss |
| `/plex <title\|recent>` · `/watch [mood]` | Plex lookup · "what should we watch tonight" |
| `/trakt [lists\|<list>]` · `/next [list:name] [mood]` | Trakt lists · pals pick from a list |
| `/request <title> [4k]` (or `@seerr`) | Request a title in Seerr |
| `/library <title\|recent>` | Jellyfin lookup |
| `/server` · `/diagnose` | Unraid status · pals look at it and advise |
| `/brief [send]` | Morning brief preview · push it now |
| `/backup [now]` | Backup status · back up now (owner) |
| `/voice [on\|off]` | Read replies aloud |
| `/dm …` · `/roll …` | Dungeon Master mode · dice |
| `/compare <question>` | Blind model comparison |
| `/log` | Debug log |

**Keyboard shortcuts:** `Ctrl+K` palette · `Ctrl+Shift+O` new chat · `Ctrl+Shift+L` debug log · `Ctrl+/` shortcut list · `Ctrl+B` sidebar · `Esc` stop (and silence voice).

---

## 7. Connecting other things

Every integration is **optional**. Each one turns on only when its variables are set. Set them in Portainer (stack → *Environment variables* → *Pull and redeploy*) or in `.env.local` and restart. API keys are only ever read by the server, never sent to the browser.

### 7.1 Web search (SearXNG)

Powers `/search` and `/research`.

1. You need a SearXNG instance with JSON output enabled in its `settings.yml`:
   ```yaml
   search:
     formats: [html, json]
   ```
2. Set `SEARXNG_URL`. Docker default: `http://host.docker.internal:8081`.
3. No SearXNG yet? `docker compose --profile search up -d` starts one using `config/searxng/settings.yml`; then set `SEARXNG_URL=http://searxng:8080`.

### 7.2 Seerr (requests)

Lets you request movies and TV from chat: `@seerr Dune Part Two 4k` or `/request Dune 4k`. Pixel Pals looks the title up and asks you to **confirm** before requesting.

| Variable | Value |
|---|---|
| `SEERR_URL` | Your Seerr address, for example `http://10.200.1.31:5055` |
| `SEERR_API_KEY` | Seerr → **Settings → General → API Key** |

Anyone who can open Pixel Pals can request through it, so keep it on your LAN or behind accounts.

### 7.3 Plex

Gives you `/plex <title>`, `/plex recent` and `/watch`, and lets Trakt results show whether each title is **in Plex**.

| Variable | Value |
|---|---|
| `PLEX_URL` | For example `http://10.200.1.X:32400` |
| `PLEX_TOKEN` | See below |

**Finding your Plex token:** in Plex's web app open any item → **⋯ → Get Info → View XML**. The address bar of the XML tab contains `X-Plex-Token=...`. Copy that value. Treat it like a password.

`/watch` (or `/watch something cozy`) gives the pals your recently added titles and has them recommend one or two **from that list only**.

### 7.4 Trakt

Pixel Pals reads your Trakt lists **directly from Trakt's API** (no Plex needed for this part), and the pals choose what to watch next.

1. On trakt.tv: **Settings → Your API Apps → New Application**. Any name, type *Development*, redirect URI `http://localhost:5173/callback` (never used). Copy the **Client ID**.
2. Set:

| Variable | Value |
|---|---|
| `TRAKT_CLIENT_ID` | The app's Client ID |
| `TRAKT_USER` | Your Trakt username |
| `TRAKT_LIST` | List short name (default `watchlist`) |
| `TRAKT_ACCESS_TOKEN` | Only for **private** lists |

3. Use it:
   - `/trakt lists` shows your lists and their short names; `/trakt <list>` shows one.
   - `/next` (or `/next list:name cozy`) has the pals choose. Movies you've already watched are skipped when your history is public.
   - **With Plex also set**, each item is marked **📺 in Plex** or *not in Plex*, and the pals prefer what you can watch right now. For anything not in Plex use `/request <title>` to open the Seerr dialog.

### 7.5 Jellyfin

`/library <title>` or `/library recent`.

| Variable | Value |
|---|---|
| `JELLYFIN_URL` | Your Jellyfin address |
| `JELLYFIN_API_KEY` | Jellyfin → **Dashboard → API Keys** |
| `JELLYFIN_PUBLIC_URL` | Optional, makes results clickable |

### 7.6 Unraid watcher

Pixel Pals checks Unraid every minute and warns you early.

| Variable | Value |
|---|---|
| `UNRAID_URL` | For example `http://10.200.1.30` |
| `UNRAID_API_KEY` | Unraid → **Settings → Management Access → API Keys** (read-only is enough) |
| `UNRAID_CHECK_SECONDS` | Default 60 |

What you get:
- A **red banner** when Unraid can't be reached (after two failed checks in a row), and an **amber banner** for warnings: array not started, a disk that isn't OK or is hot, an auto-start container that isn't running.
- A **browser notification** on change (click *Enable notifications* on the banner once; needs HTTPS or localhost).
- A **phone push** if `NTFY_URL` is set ([7.7](#77-ntfy-phone-alerts)).
- `/server` for the current status and `/diagnose` (or the banner's *What's wrong?*) for the pals' advice. Everything is read-only.

It can't watch while the Pixel Pals box itself is down. If your Unraid has no API or the key is rejected, it still tells you whether the server answers at all.

### 7.7 ntfy phone alerts

[ntfy](https://ntfy.sh) delivers push notifications to your phone. It does not need to run on Unraid.

1. Install the free **ntfy** app (iOS or Android).
2. Subscribe to a **long random topic name**, for example `pixelpals-8f3k29xq7m`. Anyone who knows the topic can read it, so make it unguessable.
3. Set `NTFY_URL=https://ntfy.sh/pixelpals-8f3k29xq7m` and redeploy.

It is used by the Unraid watcher and the morning brief. To self-host ntfy instead, point `NTFY_URL` at your own server.

### 7.8 iPhone Notes ↔ Trakt sync

Compare an iOS Note (one title per line) with your Trakt list and history. It is **read-only on Trakt**: Trakt wins and Pixel Pals never edits your Trakt data or removes your marks.

What the report tells you:

| Mark | Meaning |
|---|---|
| ✓ | Trakt says you've watched this movie (`- Heat` → `- ✓ Heat`, `[ ] Heat` → `[x] Heat`) |
| ▶ | You've started this show (never marked finished automatically) |
| flagged | You typed ✓ but Trakt doesn't confirm it (your mark is kept) |
| other | Titles that are on Trakt but not on your list, titles it couldn't find, ambiguous titles (write `Dune (2021)`), and Trakt-list items missing from the note |

**Requirements:** Trakt set up ([7.4](#74-trakt), public list or history), accounts on, and your iPhone able to reach Pixel Pals (HTTPS address).

**Step 1: create a Shortcut access token.** Sign in → top bar → people icon (*Accounts*) → **iPhone Shortcut access token → Create token**. Copy it now; it's shown once. It only works for `/api/notes-sync`.

**Step 2: build the Shortcut** (Shortcuts app → **+**):

1. **Find Notes** where *Name* is your note's title (for example `Watch list`), limit 1.
2. **Get Details of Notes → Body**.
3. **Get Contents of URL**
   - URL: `https://<your-address>/api/notes-sync?format=report&skip=1`
   - Method: **POST**
   - Headers: `Authorization` = `Bearer <your token>` and `Content-Type` = `text/plain`
   - Request Body: **File**, choose the Body text from step 2.
   - (`skip=1` ignores the first line, usually the note's title. Drop it if your Body doesn't include the title.)
4. **Show Result** (or **Append to Note** to add the report to the bottom of the note).

**Variations**
- `format=note` returns the whole note with ✓/▶ added; follow with **Create Note**. Shortcuts can append to a note but can't rewrite one in place, so this makes a new updated copy and leaves the original alone.
- `&list=<trakt list name>` uses a list other than `TRAKT_LIST`.
- Run it daily: Shortcuts → **Automation → Time of Day** → run this Shortcut.
- `format=json` returns `note`, `report` and `counts`.

**Test from a computer:**
```sh
curl -X POST --data-binary @note.txt \
  -H "Authorization: Bearer <token>" -H "Content-Type: text/plain" \
  "https://<your-address>/api/notes-sync?format=report"
```

Limits: notes up to 20,000 characters, at most 25 searches per run. Shortcut action names vary slightly between iOS versions.

### 7.9 iPhone share sheet

Send any text or link from any app straight into Pixel Pals' message box.

1. Shortcuts → **+** → set it to appear in the **Share Sheet**, accepting *Text* and *URLs*.
2. Add **URL Encode** (input: *Shortcut Input*).
3. Add **Open URLs** with `https://<your-address>/?q=` followed by the encoded text.

Whatever you share lands in the message box, ready to send (nothing is sent automatically). You must already be signed in. iOS opens the link in Safari, not the installed home-screen app.

---

## 8. Automatic jobs

Both run on the server at times in `BUDDY_TZ` (default `America/New_York`).

### 8.1 Morning brief

A single push to your phone each morning.

| Variable | Value |
|---|---|
| `BRIEF_TIME` | For example `08:00` |
| `NTFY_URL` | Required ([7.7](#77-ntfy-phone-alerts)) |

It includes Unraid health, the last backup, **tonight's pick** from your Trakt list (preferring what's already in Plex, plus two alternatives) and what's new in Plex. Each part appears only if its service is set up. The pick is a simple daily choice, not an AI opinion, so it works without any API keys.

`/brief` previews it in chat; `/brief send` pushes it to your phone right now.

### 8.2 Nightly backup

At `BUDDY_BACKUP_TIME` (default `03:30`) the server copies its data folder (accounts, saved chats, per-account settings) into `/backups` and keeps the newest `BUDDY_BACKUP_KEEP` copies (default 14). If the server was off at that time it makes one soon after starting.

- `/backup` shows status; `/backup now` makes one immediately (owner only). Status also appears in the Debug log.
- **Protect against disk failure:** by default backups sit in a Docker volume on the same machine. Mount an Unraid share on the host (for example NFS or SMB at `/mnt/unraid/pixelpals-backups`), then set `BUDDY_BACKUP_PATH=/mnt/unraid/pixelpals-backups` and redeploy.
- **Restore:** stop the stack, copy a backup folder's contents into the `buddy-data` volume, start again.

Backups contain password hashes and API keys, so keep that share private.

---

## 9. Accounts, sharing and saved settings

- **Owner:** the first account. Owners add people, reset passwords, remove accounts, run backups and can delete anyone's chat.
- **Add people:** your name (top bar) → **Accounts** → username and password.
- **Change your password:** same dialog.
- **Settings follow you.** Engine and Ollama settings, API keys, theme, presets, pal instructions and memories, to-dos, documents, Dungeon Master campaign, chat pins/renames, window layout and voice setting sync to your account. The first time you open Pixel Pals in a browser after signing in, your account's settings are applied (the page reloads once); later changes upload within a few seconds. Last change wins if two devices edit at once.
- **Chats are private.** Each account sees only its own chats. Click the **share icon** on a chat in the Chats list to share it with everyone who has an account (click again to make it private). A shared chat opens as your own copy.
- **Forgot the owner password?** Stop the stack, delete `users.json` from the `buddy-data` volume, start it and create a new owner. Chats and per-account settings stay.
- **Turn accounts off:** `BUDDY_ACCOUNTS=0` goes back to the single shared `BUDDY_PASSWORD` (or no gate at all if that is empty).

---

## 10. Using it on your phone

- **Install:** open your HTTPS address in Safari → **Share → Add to Home Screen**. (Android Chrome: menu → *Install app*.) It opens full screen with its own icon.
- **Layout on small screens:**
  - One slim header with a **⋯ menu** that holds Free keys, Record, Voice, Work tools, Accounts, theme, Assistant, Debug log, Compare models and Reset layout.
  - A **bottom tab bar**: Chat, Room, Tools, Recorder, Notes, Saved chats.
  - Tools, Notes and Recorder slide up as **bottom sheets**.
  - A thin strip under the header shows who is talking; tap it to open the room.
  - **Swipe right from the left edge** to open Saved chats.
  - Landscape gets a tighter header and composer so the chat has more room.
- **Share sheet:** see [7.9](#79-iphone-share-sheet). **Notes sync:** see [7.8](#78-iphone-notes--trakt-sync).

---

## 11. Dungeon Master mode

`/dm start <premise>` begins a campaign: the first pal narrates, the others are your party, and you say what you do.

| Command | Effect |
|---|---|
| `/dm start <premise>` | Begin |
| `/roll d20`, `/roll 2d6+3`, `/roll d20 adv` | Real dice; a natural 20 throws confetti and the DM sees your recent rolls |
| `/dm character <text>` · `/dm fact <text>` | Details the story must not forget |
| `/dm status` | Show them |
| `/dm end` | Back to normal discussions |

The same controls are in the *Notes & tasks* window.

---

## 12. Voice replies

Click **Voice** in the top bar (or `/voice`) and each discussion's replies are read aloud when it finishes, every pal in a different voice and pitch. The speaker button on any reply reads just that one; `Esc` silences it.

It uses your device's built-in voices: nothing to install, no keys, and no audio data leaves the device. Off by default; synced with your account. On iPhone, Safari only plays sound after you've tapped something on the page (sending a message counts).

---

## 13. Work tools and the recorder

All run in the browser. Files never leave your device.

- **Events:** drop Ungerboeck / "For Scheduling" PDFs (plus an optional monthly .xlsx) to get a weekly engineering schedule in Excel with color coding (green move-in, yellow show, orange move-out, teal move-in+show, blue all three).
- **My shifts:** paste or upload your schedule, download an `.ics`, or push every shift to your Google Calendar.
- **Deck:** `@deck 24x24x32` plans stage decks and stairs.
- **Vendors:** `@price` / `@gear` builds search links for Grainger, McMaster-Carr, Home Depot and 1000bulbs.
- **Recorder:** the Record button (or `@record`) opens Echo's recorder. Recording starts only when you press it, long recordings split into 14-minute parts, and **Transcribe** labels speakers. Audio is sent only when you tap Transcribe.
- **Linux desktop app:** a Tauri `.AppImage` adds a real terminal, system stats, notes and self-update. Nothing runs without your click. See [`packaging/README.md`](packaging/README.md).

---

## 14. Configuration reference

Set in Portainer's environment variables or in `.env.local`. Anything left empty is simply off.

| Variable | Default | Purpose |
|---|---|---|
| `BUDDY_PORT` | `8090` | Port the app listens on |
| `BUDDY_PASSWORD` | empty | Setup password for the first account; the shared gate if accounts are off |
| `BUDDY_ACCOUNTS` | `1` | `0` turns built-in accounts off |
| `BUDDY_TZ` | `America/New_York` | Time zone for the backup and brief |
| `SEARXNG_URL` | `http://host.docker.internal:8081` | Web search |
| `SEERR_URL`, `SEERR_API_KEY` | | Seerr requests |
| `PLEX_URL`, `PLEX_TOKEN` | | Plex lookups |
| `TRAKT_CLIENT_ID`, `TRAKT_USER` | | Trakt lists |
| `TRAKT_LIST` | `watchlist` | Default Trakt list |
| `TRAKT_ACCESS_TOKEN` | | Private Trakt lists only |
| `JELLYFIN_URL`, `JELLYFIN_API_KEY`, `JELLYFIN_PUBLIC_URL` | | Jellyfin lookups |
| `UNRAID_URL`, `UNRAID_API_KEY` | | Unraid watcher |
| `UNRAID_CHECK_SECONDS` | `60` | How often it checks |
| `NTFY_URL` | | Phone push address |
| `BRIEF_TIME` | empty (off) | Morning brief time, `HH:MM` |
| `BUDDY_BACKUP_PATH` | volume `buddy-backups` | Host folder for backups |
| `BUDDY_BACKUP_TIME` | `03:30` | Nightly backup time |
| `BUDDY_BACKUP_KEEP` | `14` | Copies to keep |

Internal (set by the Docker image/compose, rarely changed): `BUDDY_SELF_HOSTED=1`, `BUDDY_DATA_DIR=/data`, `BUDDY_BACKUP_DIR=/backups`.

**Where things are stored (volume `buddy-data`):** `users.json` (accounts, hashed), `secret.key` (signs sign-in cookies), `chats.json` (saved chats), `accounts/` (per-account settings), `/backups` (nightly copies).

---

## 15. Troubleshooting

| Symptom | Fix |
|---|---|
| Sign-up says "Usernames are 2–32 letters…" no matter what you type | Update the stack (*Pull and redeploy*): older builds dropped the form data |
| "An account already exists. Sign in." | An account was already created. Sign in, or reset by deleting `users.json` (section 9) |
| Chats say "Sign in to see them on other devices" | The container is on an old build. Redeploy |
| Browser error `PR_END_OF_FILE_ERROR` | You used `https` on a plain-HTTP port. Use `http://host:8090`, or set up Tailscale HTTPS (section 3) |
| Notifications button does nothing | Browsers need HTTPS or localhost |
| Ollama doesn't respond | Start it with `OLLAMA_ORIGINS="*" OLLAMA_HOST=0.0.0.0 ollama serve`, and make sure the URL works from the browsing device |
| `/search` fails | SearXNG must allow JSON (`formats: [html, json]`) |
| `/plex` or `/next` shows nothing | Check `PLEX_URL`/`PLEX_TOKEN` and `TRAKT_*`, and that the list is public (or set `TRAKT_ACCESS_TOKEN`) |
| Note sync returns 401 | Wrong or missing `Authorization: Bearer <token>`; create a new token in Accounts |
| Brief or backup never fires | Check `BRIEF_TIME`/`NTFY_URL`/`BUDDY_TZ`; `/brief send` and `/backup now` test them immediately |
| Anything else | Open **Debug log** (Ctrl+Shift+L or `/log`) → *Copy report*, and paste it to Claude. Keys and passwords are stripped. The same events are in the container logs |

Health check: `GET /__health` returns `ok` (Portainer shows healthy/unhealthy and restarts a crashed container).

---

## 16. Security notes

- Keep Pixel Pals on your LAN or tailnet. Don't expose port 8090 to the internet.
- Passwords are stored salted and hashed (PBKDF2-SHA512). Eight wrong tries from one address lock it out for ten minutes. Sign-in cookies last 30 days.
- API keys for Plex, Trakt, Seerr, Jellyfin and Unraid stay on the server and are never sent to the browser. Account-synced engine keys are stored **unencrypted** on the `buddy-data` volume, so protect that volume and your backups.
- The Shortcut token only works for `/api/notes-sync` and can be replaced any time.
- If you ever paste a key or token into a chat or a screenshot, rotate it.
- Work-tool files are processed in your browser; the microphone and machine actions only happen after you click.

---

## 17. Development

Requires Node.js 20+ or Bun.

```sh
bun install
bun run dev          # http://localhost:8080
bunx vitest run      # tests
```

**Stack:** TanStack Start (React 19, Vite, SSR), Tailwind CSS v4, shadcn/ui, Tauri for the desktop build, exceljs / xlsx / pdf.js for the work tools. The default build targets Cloudflare Workers on Lovable; the Docker image runs the same code on Node with `BUDDY_SELF_HOSTED=1`.

```text
src/
  routes/          pages and server routes (/api/chat, /api/trakt, /api/notes-sync, …)
  components/      room, pals, work tools, recorder, dialogs
  lib/             agents, themes, engines, Trakt/Plex/Seerr, accounts, backups, brief
  test/            vitest suites
public/            PWA manifest and icons
docs/              SELF_HOSTING.md (longer how-tos)
src-tauri/         desktop (Linux) app
packaging/         install scripts and desktop build notes
```

See [`AGENTS.md`](AGENTS.md) for architecture rules and [`docs/SELF_HOSTING.md`](docs/SELF_HOSTING.md) for extended self-hosting notes.

---

<div align="center">

Built with [Lovable](https://lovable.dev) · edit in the [Lovable editor](https://lovable.dev/projects/12804d65-d2a1-4f59-8779-f480d1faa8f1) · changes sync both ways with GitHub.

</div>

# Self-hosting Pixel Pals

## Docker (recommended)

```bash
git clone https://github.com/nyteghost/buddy-bot-room ~/buddy-bot-room
cd ~/buddy-bot-room
cp .env.local.example .env.local      # optional: Seerr, SearXNG address
docker compose up -d --build
```

Open `http://<this-machine>:8090`. Change the port with `BUDDY_PORT=9000 docker compose up -d`.

Update later: `git pull && docker compose up -d --build`.

### Web search (`/search`, `/research`)
The app talks to a SearXNG you already run. By default the container looks at
`http://host.docker.internal:8081` (SearXNG on the Docker host). Change `SEARXNG_URL` in `.env.local`.
SearXNG must allow JSON output: `search: formats: [html, json]` in its `settings.yml`.

No SearXNG yet? `docker compose --profile search up -d` starts one using `config/searxng/settings.yml`;
then set `SEARXNG_URL=http://searxng:8080`.

### Seerr (`@seerr Dune 4k`)
Set `SEERR_URL` and `SEERR_API_KEY` in `.env.local` (Seerr → Settings → General → API key). The key is
only ever read by the server. Anyone who can open the app can request through it, so keep the app on
your LAN.

### Experimental production build
`BUDDY_TARGET=prod docker compose up -d --build` builds with Nitro's Node preset instead of running the
dev server. This project targets Cloudflare Workers by default, so treat this as untested until it works
on your machine; fall back to the default `dev` target if it doesn't.

## Portainer

1. Portainer → **Stacks → Add stack → Repository**.
2. Repository URL `https://github.com/nyteghost/buddy-bot-room`, reference `refs/heads/main`.
   If the repo is private, switch on *Authentication* and use a GitHub personal access token.
3. **Compose path:** `docker-compose.portainer.yml`
4. Optional **Environment variables:** `SEERR_URL`, `SEERR_API_KEY`, `SEARXNG_URL`, `BUDDY_PORT`.
5. **Deploy the stack**, then open `http://<host>:8090`. To update, open the stack and press
   *Pull and redeploy*; the compose file's `pull_policy: build` makes it rebuild the image.

Newer Portainer versions ask for a **Source** first: choose *Create new source*, give it a name, enter the
repository URL, and add a token only if the repo is private.

## Without Docker

```bash
bun install
bun run dev --host 0.0.0.0 --port 8090
```
Put the same variables in `.env.local` (bun loads it automatically).

## The AI engine
The default "Lovable AI" engine only works on Lovable's hosting. Self-hosted, pick **Ollama** or add a
free Groq/Gemini/OpenRouter/NVIDIA key in AI engine settings. Ollama is called by your **browser**, so the
URL must be reachable from the machine you browse on, and Ollama needs
`OLLAMA_ORIGINS="*" OLLAMA_HOST=0.0.0.0 ollama serve`.

## Sign-in

The Docker build runs in **Local mode** (`BUDDY_SELF_HOSTED=1`, set in the Dockerfile). Lovable's Google sign-in can't redirect back to a LAN address, so the button is replaced by a "Local mode" label (or your own Google sign-in, see below). Engine settings, keys and theme are saved in the browser instead of an account. Sign-in still works on the Lovable-hosted app.

## Password, health, logs and saved chats

- **Password:** set `BUDDY_PASSWORD` (Portainer env var, or `.env.local`). Everyone must enter it once per browser (a 30-day cookie that holds a hash, never the password). Leave it empty for no gate. Eight wrong tries from one address lock that address out for ten minutes.
- **Healthcheck:** the container answers `/__health`; Portainer shows it as healthy/unhealthy and `restart: unless-stopped` brings it back after a crash.
- **Saved chats** are stored on the server in the `buddy-data` volume (`/data/chats.json`), so every browser on your network sees the same chats. Pins and renames are per browser.
- **Debug log:** sidebar → *Debug log* (or `/log`, or Ctrl+Shift+L) → *Copy report*, then paste it to Claude. It contains the app version, your engine settings (never keys), recent server events and browser errors, with API keys and passwords stripped. The same server events are in the container's logs in Portainer.
- **Jellyfin (`/library <title>` or `/library recent`):** set `JELLYFIN_URL` and `JELLYFIN_API_KEY` (and optionally `JELLYFIN_PUBLIC_URL` for clickable links). Create the key in Jellyfin → Dashboard → API Keys.
- **Backup:** Ctrl+K → *Export settings* / *Import settings*. Exports leave API keys out unless you pick the "including API keys" option.

## Dungeon Master mode

`/dm start <premise>` begins a campaign: the first pal in the room narrates, the others are your party, and you just say what you do. `/roll d20`, `/roll 2d6+3` and `/roll d20 adv` roll real dice (a natural 20 throws confetti) and the DM sees your recent rolls. `/dm character <text>` and `/dm fact <text>` keep details the story must not forget; `/dm status` shows them and `/dm end` goes back to normal discussions. The same controls are in the Notes & tasks window.

## Unraid watcher

Set `UNRAID_URL` (for example `http://10.200.1.30`) and `UNRAID_API_KEY` (Unraid → Settings → Management Access → API Keys; a read-only key is enough) in the stack's environment variables, then redeploy. The server checks Unraid every `UNRAID_CHECK_SECONDS` (default 60) and:

- shows a **red banner** when it can't reach Unraid (after two failed checks in a row, so one blip doesn't alarm you) and an **amber banner** for warnings (array not started, a disk that isn't OK or is running hot, an auto-start container that isn't running);
- sends a **browser notification** when that changes (click *Enable notifications* on the banner once; browsers only allow this on HTTPS or localhost);
- sends a **phone push** if `NTFY_URL` is set. Install the free ntfy app, subscribe to a long random topic, and set `NTFY_URL=https://ntfy.sh/<that topic>`;
- writes each change to the server log (see the Debug log).

`/server` shows the current status and `/diagnose` (or the banner's *What's wrong?* button) hands the facts to the pals for advice. Everything is read-only. It can't watch while the Pixel Pals box itself is down. If your Unraid version has no API or the key is rejected, the watcher still tells you whether the server answers at all.

## Google sign-in (Docker)

Instead of (or as well as) the shared password you can require Google sign-in. Only the emails you list can get in, and each person's engine settings, keys and theme follow their Google account across devices (saved on your server's `buddy-data` volume, not on Lovable). Saved chats stay shared by everyone who is allowed in.

Google only accepts an `https://` return address (not a plain `10.x` IP), so open Pixel Pals through Tailscale HTTPS first (`sudo tailscale serve --bg --https=443 http://localhost:8090`).

1. Go to console.cloud.google.com → create a project → *APIs & Services → OAuth consent screen* (User type *External*, leave it in *Testing*, and add your Google emails under *Test users*).
2. *Credentials → Create credentials → OAuth client ID → Web application*. Under *Authorized redirect URIs* add `https://<your-name>.ts.net/__google/callback` (the exact address you open Pixel Pals at, plus `/__google/callback`).
3. Copy the **Client ID** and **Client secret** and add these stack variables:
   - `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET`
   - `GOOGLE_ALLOWED_EMAILS` (comma separated; `@example.com` allows a domain)
   - `BUDDY_PUBLIC_URL` (the same `https://<your-name>.ts.net` address)
4. *Pull and redeploy*. Opening the page now shows **Sign in with Google**; if `BUDDY_PASSWORD` is also set, either works.

Remove an email from `GOOGLE_ALLOWED_EMAILS` and redeploy to cut that person off. If sign-in fails, the page names the reason (for example `redirect_uri_mismatch` means the URI in step 2 doesn't match exactly), and the Debug log has the details.

## Trakt: `/next` and `/trakt`

Pixel Pals reads your Trakt lists straight from Trakt's API (no Plex involved) and the pals pick what to watch next from one.

1. On trakt.tv go to *Settings → Your API Apps → New Application*. Any name, type *Development*, and `http://localhost:5173/callback` as the redirect URI (it is never used; Pixel Pals only reads public lists with the Client ID). Copy the **Client ID** from the app's page.
2. In the stack's environment variables add `TRAKT_CLIENT_ID`, `TRAKT_USER` (your Trakt username) and optionally `TRAKT_LIST` (the list's short name; default `watchlist`). Then *Pull and redeploy*.
3. Public lists need nothing more. For private lists also set `TRAKT_ACCESS_TOKEN`.

Commands: `/trakt lists` shows your lists and their short names, `/trakt <list>` shows one, `/next [list:name] [mood]` has the pals choose from it (movies you've already watched are skipped when your history is public).

## Plex: `/plex` and "What should we watch tonight?"

Set `PLEX_URL` (for example `http://10.200.1.X:32400`) and `PLEX_TOKEN` in the stack's environment variables. To find the token: in Plex's web app open any item → ⋯ → *Get Info* → *View XML*, and copy the `X-Plex-Token=` value from the address bar. Then:

- `/plex <title>` looks a title up in your library (`/plex recent` lists what was added lately).
- `/watch` (or `/watch something cozy`, or Ctrl+K → *What should we watch tonight?*) gives the pals your recently added titles and has them debate and recommend one or two **from that list only**. If nothing fits they say what you could request with `@seerr`.

Nuvio is a player app with no server or API of its own, so there is nothing for Pixel Pals to connect to there; it just plays what you choose.

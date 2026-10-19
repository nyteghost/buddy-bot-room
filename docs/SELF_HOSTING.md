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

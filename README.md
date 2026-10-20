<div align="center">

# Pixel Pals · Buddy Bot Room

**A multi-model AI chat room where a cast of pixel-art characters talk your topic through, backed by free or local AI, plus an optional self-hosted hub for your media, server, phone and calendar.**

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
   - [Web search (SearXNG)](#71-web-search-searxng) · [Seerr](#72-seerr-requests) · [Plex](#73-plex) · [Trakt](#74-trakt) · [Jellyfin](#75-jellyfin) · [Unraid watcher](#76-unraid-watcher) · [ntfy phone alerts](#77-ntfy-phone-alerts) · [iPhone Notes ↔ Trakt](#78-iphone-notes--trakt-sync) · [iPhone share sheet](#79-iphone-share-sheet) · [Mac Notes helper](#710-mac-notes-helper) · [Microsoft 365 (work)](#711-microsoft-365-work-read-only) · [Calendar and Mail windows](#712-calendar-and-mail-windows) · [Today, Tasks, weather and events](#713-today-tasks-weather-and-events) · [Setup, search, capture and more](#714-settings-search-capture-and-more) · [iPhone Reminders sync](#715-iphone-reminders-sync-radicale)
8. [Automatic jobs](#8-automatic-jobs): [Morning brief](#81-morning-brief) · [Nightly backup](#82-nightly-backup) · [Scheduled tasks](#83-scheduled-tasks) · [Telegram bot](#84-telegram-bot)
9. [Accounts, sharing and saved settings](#9-accounts-sharing-and-saved-settings)
10. [Using it on your phone](#10-using-it-on-your-phone)
11. [Dungeon Master mode](#11-dungeon-master-mode)
12. [Voice replies and dictation](#12-voice-replies-and-dictation)
13. [Work tools and the recorder](#13-work-tools-and-the-recorder)
14. [Configuration reference](#14-configuration-reference)
15. [Troubleshooting](#15-troubleshooting)
16. [Security notes](#16-security-notes)
17. [Development](#17-development)

---

## 1. What is Pixel Pals?

Pixel Pals is a chat room where a cast of pixel-art pals, each running on an AI model of your choice, talk your topic through, and a private home hub that can look after the rest of your digital life. You can use it as a fun group chat with AIs, as a calm one-to-one assistant, or both.

### The chat room

- **Eight pals** (seven classic pals plus Saiyan, who has real art for all eight facing directions) that walk the office in eight directions, sit at their desks and act out what they're doing. Each theme (Hellraiser, Matrix, Final Fantasy, Dev Team, Cyberpunk, Dungeon Crawler Carl, Linux and more) recasts them with new names, looks and personalities.
- **Four ways to talk:** roundtable (they respond to each other), broadcast (independent answers), one-on-one, and problem solving (they debate and deliver a verdict). There is also a Dungeon Master mode with dice, and a blind model **Compare** mode.
- **Chat with your files:** attach documents and the pals answer from them, finding passages by meaning when Local AI is available.
- **Calm when you want it:** Focus mode strips the screen down to just the chat, there are light and dark colours and three text sizes, and the layout is built for phones as well as desktops.

### Your AI, your choice (free by default)

- **Free cloud keys:** a guided wizard helps you collect free API keys (Groq, Gemini, OpenRouter, NVIDIA and more) and spreads the pals across them.
- **Local AI on your own machine:** a bundled Ollama detects your CPU, RAM and GPU, suggests models that fit, downloads them, and can choose the best installed model for each kind of task automatically (chat, code, reasoning, quick replies), or a model per pal.
- **Optional paid providers** (Claude, or any OpenAI-compatible service) are off until you switch them on, carry a clear warning, and can be capped by a monthly spend limit.
- **Works without a server too:** a small in-browser model is available on the hosted app.

### A private hub for your home server (self-hosted)

- **Media:** ask what to watch from Plex, Trakt and Jellyfin, request titles through Seerr, and (optionally) add to your Trakt watchlist from chat.
- **Your server:** an Unraid watcher with phone alerts (ntfy), a morning brief, and nightly backups.
- **Your phone:** a one-tap iPhone setup for Notes sync and the share sheet, a Telegram bot to message your pals from anywhere, and dictation through a built-in Whisper container.
- **Automation:** scheduled tasks that ask the pals something at a set time and send the answer to your phone, and a `/status` check of every service.
- **Work:** read-only Microsoft 365 calendar and unread mail subjects, summarised by Local AI only, so work content never goes to a cloud model.
- **Safe by design:** built-in accounts with an owner, API keys and tokens stay on your server, anything that changes something outside the app only happens when you type the command, and unattended jobs never use paid providers.

### Two ways to run it

| | Lovable-hosted app | Self-hosted (Docker / Portainer) |
|---|---|---|
| Where | https://buddy-bot-room.lovable.app | Your own server or PC |
| Sign-in | Optional Google sign-in | Built-in accounts (no outside service) |
| Local AI, hub features, scheduled tasks, Telegram, dictation, backups | Not available | Yes (sections 5, 7 and 8) |
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
4. **Tailscale inside the stack (no host setup, no open ports).** In Portainer add `COMPOSE_PROFILES=tailscale` and `TS_AUTHKEY` (a reusable auth key from the Tailscale admin console, *Settings → Keys*), optionally `TS_HOSTNAME` (default `pixelpals`), and redeploy. The `tailscale` container joins your tailnet and serves Pixel Pals at `https://pixelpals.<your-tailnet>.ts.net`. HTTPS must be enabled once in the Tailscale admin console (*DNS → HTTPS Certificates*). This replaces a Caddy/reverse-proxy setup for private use; the page is reachable only from devices on your tailnet. The serve rules are inline in the compose file (the same JSON is in `config/tailscale/serve.json`), which needs Docker Compose 2.23 or newer. 

---

## 4. The room

- **Seven pixel pals, plus Saiyan** with hand-drawn sprites that walk, sit at desks and act out tasks. In the Linux/Assistant office they walk in all eight directions and lean, shrink and grow slightly as they turn.
- **Saiyan** (the eighth pal, a cyberpunk dragon-ball fan: "the power-up", motivation and goals) has real art for every facing direction, so he turns to face where he is walking and shows his back at a desk. He is **off by default**; switch him on under *The pals*. Mention him with `@saiyan` or `@goals`. Art lives in `src/assets/pals/saiyan/` (`north.png` … `south-west.png`); replace those eight files to change him.
- **Themes** swap the entire cast (names, looks, personalities, room): Normal, Hellraiser, Horror, Matrix, Final Fantasy, Dev Team, Cyberpunk, Dungeon Crawler Carl and Linux.
- **Conversation modes**, each in its own window with its own chat and message box (open them from the left menu; one answers at a time):
  - *Roundtable*: pals respond to each other, then the lead pal gives a verdict (Agreed / Disputed / Verdict).
  - *Broadcast*: every pal answers on their own. Tick "Judge picks the best" and one pal ranks the answers.
  - *One-on-one*: a private chat with one pal. The menu shows which AI each pal uses, like "Nova (Groq · gpt-oss-120b)".
  - *Problem solving*: a team with roles (Diagnoser, Fixer, Skeptic) that ends in a plan (Best approach / Steps / Watch out). The "Add these steps to Tasks" button on the plan puts the steps on your task list.
  - *Debate*: two pals argue for and against your claim and a third judges who argued better.
  - Every window has **Keep going** (one more step) and **Summarize** (a short recap of that chat). `/mode debate` etc. opens the window.
- **Rounds**: how many times the pals go around (1–5).
- **@mentions** talk to one pal directly: `@calendar`, `@gmail`, `@notes`, `@system`, `@terminal`, `@deck`, `@price`, `@gear`, `@seerr`, `@record`.
- **Assistant Mode** turns any cast into office helpers while keeping their names and voices.
- **Chat niceties:** ↑/↓ prompt recall, hidden `<think>` blocks from reasoning models, emoji shortcodes (`:fire:` → 🔥), copy a reply, edit and resend your own message, regenerate, branch a conversation.
- **Saved chats:** auto-saved, searchable, renameable, pinnable (per browser). Self-hosted chats are stored on the server and are private per account (see [section 9](#9-accounts-sharing-and-saved-settings)).
- **Compare models** (`/compare`): sends one question to 2–3 engines with the names hidden. You vote, then see who wrote what; a scoreboard is kept in your browser.
- **Pal memory, notes and to-dos:** memories and notes in the *Notes* window (to-dos are in *Tasks*). Open to-dos and memories are shared with every pal. You can also attach **documents** that the pals use as reference.
- **Presets and settings export/import:** Ctrl+K → *Export settings* / *Import settings*. Exports leave API keys out unless you choose "including API keys".

---

### Appearance (light colours and text size)

`/appearance light`, `/appearance dark` or `/appearance auto` (follow your device), and `/appearance small`, `normal` or `large` for the text size. Both are also in the command palette (Ctrl+K). They apply per device and sync with your account.

The light scheme is for the **Normal** theme; the themed casts (Hellraiser, Matrix and so on) keep their own palettes, and the pixel-room scene stays dark on purpose. Text size scales the whole page with browser zoom, so very large sizes can make the phone layout cramped.

### Focus mode (calm, chat-only view)

Click the expand icon in the header, type `/focus`, or press `Ctrl+Shift+F`. The pixel room, sidebar, tab bar and extra panels disappear, the chat fills the screen as a centred reading column with softer colours, no animation and no avatars, and the message box sits quietly at the bottom. It works the same on desktop and phone.

Everything else is still one tap away: the **⋯ menu** (top right) holds engine settings, Record, Voice, Work tools, Accounts and the rest, and **Options** under the message box brings back the conversation mode and rounds. Leave with the same button, `/focus off` or `Ctrl+Shift+F`. It is remembered per device, so your phone and your PC can differ.

## 5. AI engines and API keys

Open **Free keys** (or *AI engine*) in the top bar. Pick one engine or let **Auto** try several.

| Engine | Where to get it | Notes |
|---|---|---|
| **Lovable AI** | Built in | Only works on Lovable's hosting, not self-hosted |
| **Groq** | https://console.groq.com/keys | Free tier, very fast |
| **Gemini** | https://aistudio.google.com/app/apikey | Free tier |
| **OpenRouter** | https://openrouter.ai/keys | Has free models |
| **NVIDIA NIM** | https://build.nvidia.com | Free credits |
| **Claude (Anthropic)** | https://console.anthropic.com/settings/keys | **Paid**, billed per use. Off until you enable it (see below) |
| **Ollama** | Your own machine | No key; fully local |
| **WebGPU** | Runs in your browser | Small model, nothing leaves the device |
| **Auto** | | Free keys first, then WebGPU or Ollama |

Keys are sent with each request and never stored in plain text server-side. On the Docker build, with accounts on, your keys sync to your account on the server (the `buddy-data` volume, not encrypted) so every device has them.

### Get free keys (guided)

In **Free keys** (engine settings) the **Get free keys** panel walks you through it. Pixel Pals can't create the keys for you, because each provider requires you to sign in on their site. For each provider:

1. Tap **Open key page** and create a key there.
2. Copy it, come back, and either paste it into **Paste a key here** or tap **Add from clipboard**. The provider is recognised from the key's prefix (`gsk_` Groq, `AIza` Gemini, `sk-or-` OpenRouter, `nvapi-` NVIDIA) and saved in the right slot.
3. It is tested automatically (one free "list models" request from the server). Tap **Test** any time to re-check. A green tick means the key works.

### More free providers (community list)

Under **Get free keys → More free providers** the server shows a list of free-tier and trial-credit LLM APIs with their limits and a link to each one's key page (or its website when I don't have a key-page link). It reads the community-maintained list at github.com/cheahjs/free-llm-api-resources once a day (and on **Check now**), so new providers show up without an update. The list isn't checked by Pixel Pals; limits and terms change, so read them before signing up. Providers Pixel Pals can already use are marked **works here**; the rest are listed for reference. Set `PROVIDER_FEED=0` to never fetch it.

### Custom provider (any OpenAI-compatible API)

For Hugging Face, Mistral, Cerebras and most providers on the community list, use **Custom provider** in the engine settings: pick a preset or enter a **base URL** (for example `https://router.huggingface.co/v1`), an **API key** and a **model** name, then press **Test**. It stays **off** until you choose *Share turns with my other keys* or *Use only this provider*. Tick **This provider charges money** if it does, and an amber **PAID** warning shows while it's on. Only providers that speak the OpenAI chat format work; a provider with its own format (for example Jev, which returns structured scores rather than chat text) can't be used this way.

The server makes the call for you, so it only accepts public `https://` addresses. To use a model on your own network (LM Studio, vLLM, another PC), the server owner sets `ALLOW_PRIVATE_CUSTOM=1` on the stack.

### Claude (paid)

Claude is the one **paid** option. It is billed to your own Anthropic account, separately from any Claude subscription. In the engine settings, the amber **Claude (Anthropic) — paid service** box has:

- **Claude API key:** create it at console.anthropic.com → Settings → API Keys. Add a small amount of credit and set a monthly spending limit there.
- **How to use Claude:** *Off* (default, never charged), *Share turns with my free keys* (some replies are paid), or *Use only Claude* (every reply is paid). Pasting a key never turns it on by itself.
- **Model:** Haiku 5.5 (about $0.10 in / $0.50 out per million tokens, a few cents per discussion), Sonnet 5.5 ($2 / $10) or Opus 5.5 ($4 / $20).

Compare models only uses the free keys, so it never spends Claude credit.

### Fallback, spend cap and speed test

- **Fallback chain:** if a provider errors or hits its rate limit before writing anything, the turn is retried on your next free key automatically. Claude and a custom provider each have an **Only when my free keys fail** option, so paid usage only happens when the free ones can't answer.
- **Usage and spend:** the engine settings show an estimate of replies, tokens and cost this month per provider (estimated at about 4 characters per token, kept in the browser; the provider's own dashboard is the real bill). Set a **monthly cap** and paid providers are skipped once the estimate reaches it; free keys keep working. For a paid custom provider, enter its price per million tokens so the estimate works.
- **Speed test:** in the Local AI panel each installed model has a **Speed test** button. It reports tokens per second and how much of the model is on the GPU, so you can see whether a model fits your VRAM.

### Setting up Ollama

**Portainer stack (Local AI, recommended):** Ollama is included in `docker-compose.portainer.yml`, and Pixel Pals talks to it from the server, so there is no address to type and no HTTPS problem. Choose the engine **Local AI (this server)** in the engine settings. The panel there:

- shows what it found: **CPU, RAM and GPU** (the GPU needs `OLLAMA_RUNTIME=nvidia` on the stack plus the NVIDIA Container Toolkit on the host; otherwise set `LOCAL_VRAM_GB` to your card's memory, or it assumes CPU);
- **suggests the best model per task** that fits your hardware, with a **Download** button that shows progress. Suggestions are chosen by memory: the largest model per task that fits your GPU's VRAM (or a conservative slice of RAM on CPU). The catalogue is a fixed list of well-known Ollama models, so check the Ollama library for newer ones; use **More models** for anything else in the list;
- lets you pick a **model per task**: *Chat* (default), *Code* (messages that look like programming), *Reasoning* (Problem-solving mode and step-by-step questions) and *Quick replies* (very short messages). With **Choose automatically** on, each message is routed by what it looks like; turn it off to always use the Chat model. Tasks you leave as "Same as Chat" use the Chat model;
- offers **Automatic (best installed)** for every task, or **Set all to Automatic** in one click. For each message the server then picks, from the models you have already downloaded, the best one for that task on this machine: the largest that fits your GPU's memory for Chat, Code and Reasoning (a 14B model won't be picked on a 10 GB card), and the smallest quick model for Quick replies. It reads what is installed at the moment of the request, so a model you download later is used straight away, and embedding models are ignored. A task with no suitable model borrows the Chat choice. The dropdown shows what Automatic currently resolves to;
- lets you give **each pal its own model** (for example one pal on a coding model and another on a chat model). A pal's own model overrides the task choice;
- shows **New on Ollama**: the Pixel Pals server reads ollama.com's public model library about once a day (and on **Check now**), and lists newly published, popular models that fit your hardware, with the task they're probably good at. They are labelled *Not tested by Pixel Pals*. Ollama has no official API for this, so it reads the library web page; if that page changes and can't be read, the panel says so and keeps the built-in suggestions. Set `MODEL_FEED=0` to never contact ollama.com;
- lists installed models with a remove button.

Chat with your files uses `nomic-embed-text` (pulled with the first-start models) to find passages by meaning, so a question can match a document that uses different words. If it isn't there, search quietly falls back to keywords.

First-start models come from `OLLAMA_MODELS` (default `qwen2.5:7b`; space-separated list for more). `OLLAMA_PORT` changes the published port, which you only need if something outside the stack wants to reach Ollama. Switching models makes the first reply after a switch slower, because it has to load.

**Pointing at another Ollama:** set `OLLAMA_URL` (for example `http://10.200.1.40:11434`) and use the same engine.

**Direct from the browser (older method):** the **Ollama** engine calls Ollama from your browser, so its address must be reachable from the device you browse on:

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
| `/remember <fact>` · `/memories` · `/forget <n\|all>` | Pal memory. Add `@name` to tell only one pal: `/remember @byte I use Arch`, `/forget @byte 1` |
| `/prompt [name]` | Saved prompts that fill the message box; `/prompt save <name> = <text>`, `/prompt remove <name>`. Also in Ctrl+K ([7.14](#714-settings-search-capture-and-more)) |
| `/note <text>` · `/todo <task>` · `/done <n>` · `/tasks` | Notes and to-dos |
| `/search <query>` · `/research <question>` | Web search · search then discuss |
| `/plex <title\|recent>` · `/watch [mood]` | Plex lookup · "what should we watch tonight" |
| `/trakt [lists\|<list>]` · `/next [list:name] [mood]` | Trakt lists · pals pick from a list |
| `/trakt connect\|status\|add <title>\|watched <title>\|remove <title>` | Change your Trakt (owner only, [7.4](#74-trakt)) |
| `/m365 today\|mail\|summary\|connect\|disconnect` | Read-only work calendar and unread mail subjects ([7.11](#711-microsoft-365-work-read-only)) |
| `/request <title> [4k]` (or `@seerr`) | Request a title in Seerr |
| `/library <title\|recent>` | Jellyfin lookup |
| `/server` · `/diagnose` | Unraid status · pals look at it and advise |
| `/brief [send]` | Morning brief preview · push it now |
| `/backup [now]` | Backup status · back up now (owner) |
| `/backup list` · `/backup restore N` | List backups · restore one, with a safety copy and a confirm step (owner, [7.14](#714-settings-search-capture-and-more)) |
| `/update` | Check for a newer version and how to install it (owner) |
| `/review [send]` | Your week ahead: calendar, reminders, mail, picks ([7.14](#714-settings-search-capture-and-more)) |
| `/setup` · `/find` · `/hide` | Settings: connect things and test them · search everything · blur secrets for screenshots ([7.14](#714-settings-search-capture-and-more)) |
| `/voice [on\|off]` | Read replies aloud |
| `/dm …` · `/roll …` | Dungeon Master mode · dice |
| `/compare <question>` | Blind model comparison |
| `/focus [on\|off]` | Focus mode: calm, chat-only view |
| `/appearance light\|dark\|auto` · `small\|normal\|large` | Colour scheme and text size |
| `/schedule add 08:00 <question>` | Scheduled tasks sent to your phone; also `list`, `run N`, `remove N` (owner only, [8.3](#83-scheduled-tasks)) |
| `/calendar` · `/mail` | Open the Calendar / Mail window ([7.12](#712-calendar-and-mail-windows)) |
| `/today` · `/tasks` | Open the Today overview / the Tasks and reminders window ([7.13](#713-today-tasks-weather-and-events)) |
| `/weather` | Current weather and the next few days ([7.13](#713-today-tasks-weather-and-events)) |
| `/remind in 30m call mom` | One-time reminder pushed to your phone; also `list`, `remove N` (owner only) |
| `/event friday 3pm dentist` | Makes a calendar event: `.ics` download plus Google and Outlook "add" links |
| `/web [on\|off]` | Automatic web lookup: when a question needs current facts (latest, price, news, a question with a `?`), the pals search your SearXNG first and cite the links. Off by default |
| `/status` | One-shot health check: Local AI, search, Plex, Seerr, Jellyfin, Unraid, Trakt, ntfy and backups. Shows names and problems only, never addresses or keys |
| `/log` | Debug log |

**Keyboard shortcuts:** `Ctrl+K` palette · `Ctrl+Shift+O` new chat · `Ctrl+Shift+F` focus mode · `Ctrl+Shift+L` debug log · `Ctrl+/` shortcut list · `Ctrl+B` sidebar · `Esc` stop (and silence voice).

---

## 7. Connecting other things

Every integration is **optional**. **Most can be set up inside the app:** open **Settings** (top menu or `/setup`), press **Set up** or **Edit** on a card, fill in the details and **Save**. It takes effect right away, with no redeploy. Values are saved in your data folder; keys and passwords go in a separate file that is write-only (the app never shows them back) and is left out of backups. A value set as an environment variable (Portainer → stack → *Environment variables*, or `.env.local`) wins and shows as locked in the app, so remove it there if you want to manage it in the app. Only things the stack needs before the app starts stay in Portainer: `COMPOSE_PROFILES`, `TS_AUTHKEY`/`TS_HOSTNAME`, `RADICALE_PASSWORD`/`RADICALE_USER`, `OLLAMA_RUNTIME` and the other Ollama/Whisper container settings, `BUDDY_PASSWORD`, accounts and the data and backup folders. API keys are only ever read by the server, never sent to the browser.

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

**Adding to Trakt from chat (optional write access):** by default Pixel Pals only reads Trakt. To let the owner account change it, set `TRAKT_CLIENT_SECRET` (from the same app at trakt.tv/oauth/applications) and redeploy, then:

- `/trakt connect` → open the link, enter the code, approve. `/trakt status` confirms.
- `/trakt add <title>` adds to your watchlist, `/trakt watched <title>` marks it watched, `/trakt remove <title>` takes it off the watchlist. The reply names exactly what it matched (for example *Dune (2021) — movie*), so you can correct a wrong guess with a more exact title.
- Writes only happen when **you** type the command, never from a pal's reply. The login is stored in the data volume (`trakt-auth.json`) and is also used to read private lists.

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

**Shortcut:** the quickest way is the **Connect iPhone** button (phone icon next to your name in the top bar). It creates the token, fills in your real address, and gives a Copy button for every value (URL, `Authorization` header, `Content-Type`) with the steps beside them. It has a tab for the share sheet too. The manual steps below show the same thing.

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

### 7.10 Mac Notes helper

For a Mac, `tools/mac-helper/notes-sync.sh` does what the iPhone Shortcut does ([7.8](#78-iphone-notes--trakt-sync)): it reads **one** Apple Note you name, sends it to your server and writes the updated text back. It reads nothing else on the Mac, and Messages are deliberately not touched.

```bash
PP_URL="https://pixelpals.example.com" PP_TOKEN="pp_..." PP_NOTE="Watchlist" ./tools/mac-helper/notes-sync.sh
```

Use your access token from *Connect iPhone*. Try it with `PP_DRY=1` first (prints the result without changing the note). The first run asks to let Terminal control Notes (System Settings → Privacy & Security → Automation). To run it daily, put the command in a `launchd` job or `cron`. It was written without a Mac to test on, so check the dry run before trusting it with a note you care about.

### 7.11 Microsoft 365 (work, read-only)

See today's **work calendar** and the **subjects of unread mail**, from chat. Nothing is ever sent, created or changed, and mail bodies are never requested.

1. In the Azure portal (**Microsoft Entra ID → App registrations → New registration**) create an app, then under **Authentication** turn on **Allow public client flows**. Add the delegated Microsoft Graph permissions `User.Read`, `Calendars.Read` and `Mail.ReadBasic`.
2. Set `M365_CLIENT_ID` to the app's *Application (client) ID* (and `M365_TENANT` if you want to limit it to your organisation's tenant id; default `organizations`) and redeploy.
3. Run `/m365 connect`, open the link, enter the code and sign in with your work account.

Commands: `/m365 today`, `/m365 mail`, `/m365 summary`, `/m365 status`, `/m365 disconnect`. Owner only.

- `/m365 summary` asks **Local AI (Ollama) only**, so work content never goes to a cloud model, free or paid. If Local AI isn't available you just get the plain lists.
- **Check your organisation's rules first.** Many workplaces require an admin to approve new apps, or forbid connecting work data to personal servers. Don't set this up against a work account if that's not allowed. The sign-in token is saved in the data volume (`m365-auth.json`); `/m365 disconnect` deletes it.

### 7.12 Calendar and Mail windows

Two windows in the left **Workspace** sidebar (also `/calendar`, `/mail` and the command palette) show your **next 7 days** and your **unread mail**. They are read-only and owner-only, and the addresses and passwords stay on the server.

**Calendar** reads private `.ics` links, so there is no sign-in and no app registration:

- **Google Calendar:** Settings → your calendar → *Integrate calendar* → **Secret address in iCal format**.
- **iCloud:** Calendar → share → *Public Calendar* → copy the link (it is public to anyone with the link).
- **Outlook.com:** Settings → Calendar → *Shared calendars* → publish → copy the **ICS** link.
- **Cozi:** Settings → *Shared Cozi Calendars* → switch the person (or *All*) to *Shared* → *View or send Cozi URL* → *Copy Cozi URL*. Paste it into *Settings → Calendar feeds*. It is read-only: Cozi events show here, but you can't edit Cozi from Pixel Pals. (`webcal://` links work too.)

Paste the links into *Settings → Calendar feeds* (or `CALENDAR_ICS_URLS`, comma separated, up to 6). Repeating events, all-day events, time zones and cancelled events are handled. Treat these links like passwords: anyone with one can read that calendar. If you connected Microsoft 365 ([7.11](#711-microsoft-365-work-read-only)) its events appear too, labelled by source.

**Mail** (owner only) connects to Gmail, iCloud, Outlook.com, Fastmail or any IMAP mailbox and lets you **read, reply, write and send, move and delete** mail. Open **Settings → Mail**, press **Fill in for Gmail**, enter your address and an **app password**, **Save**, then **Test** (it checks reading and sending).

- **Gmail app password:** turn on 2-Step Verification for your Google account, then create a 16-character app password at `myaccount.google.com/apppasswords`. Your normal password won't work. Google Workspace accounts may need the admin to allow app passwords.
- **Reading:** pick a folder, search it, filter to unread, open a message. Bodies are shown as **plain text** (HTML is turned into text, images and remote content are never loaded, attachments are listed by name and not downloaded, and only the first 300 KB of a message is fetched). Opening a message marks it read; *Mark unread* undoes that.
- **Delete** moves the message to Trash (recoverable). Inside Trash or Spam it deletes for good. **Move** puts it in any folder on the account.
- **Send and Reply:** plain text only, no attachments. Nothing is sent until you press **Send** and then confirm. Recipients are checked, header lines can't be injected, and there is a limit of 20 sends per hour. Gmail keeps a copy in Sent by itself; other providers may not.
- **Echo drafts:** *Get a draft from Echo* gives Echo only the sender, the subject and the few words you type, never the message itself.
- **Variables** (all editable in Settings, no redeploy): `IMAP_HOST` (`imap.gmail.com`, `imap.mail.me.com`, `outlook.office365.com`, `imap.fastmail.com`), `IMAP_USER` (your full address), `IMAP_PASS` (the app password), optional `IMAP_PORT` (993), `SMTP_HOST` (guessed from the IMAP name, e.g. `smtp.gmail.com`), `SMTP_PORT` (465, or 587 with STARTTLS) and `MAIL_FROM_NAME`.
- Everything runs on your server over encrypted connections; the app password is stored write-only and is left out of backups. If the mail server doesn't offer encryption on port 587, Pixel Pals refuses to send the password.
- I tested it end to end against a stand-in IMAP and SMTP server that behaves like Gmail (list, search, read, move, delete, send, refusals). I could not run it against a real Gmail account, so the first connection is a shakedown.

Microsoft 365 work mail can be added with `/m365 connect` instead. Results are cached for a minute and refresh every five minutes while the window is open. I could not test IMAP against a real mailbox, so if your provider refuses the login, check that IMAP access and the app password are enabled and look at the message under the list.

---

### 7.13 Today, Tasks, weather and events

- **Today** window (`/today`): weather, your calendar for today, unread mail count, open tasks and one Trakt pick, each with a short setup hint if it isn't connected yet.
- **Tasks** window (`/tasks`): your to-do list (kept in this browser; open ones are shared with the pals) and **reminders** (kept on the server, pushed to your phone by ntfy or Telegram when due). Reminders understand plain English: `/remind in 30m call mom`, `/remind tomorrow 9am pay rent`, `/remind friday at 3pm submit report`. Needs `BUDDY_DATA_DIR`, plus `NTFY_URL` or Telegram to reach your phone. Owner only.
- **Weather** (`/weather`): from Open-Meteo, which needs no key. Set `WEATHER_LOCATION="Atlanta, GA"` (or `WEATHER_LAT` and `WEATHER_LON`), and `WEATHER_UNITS=metric` for Celsius. The morning brief now also carries the weather, today's calendar, unread mail and today's reminders when those are set up.
- **Draft a reply** (Mail window): pick a message, type what you want to say, and Echo writes the reply for you to copy into your own mail app. Echo only sees the sender, subject and your notes, never the message, and nothing is sent.
- **`/event friday 3pm dentist for 1h`**: gives you a `.ics` file (opens in Apple, Outlook, Google and most calendar apps) and one-tap "Add to Google Calendar" / "Add to Outlook" links. Pixel Pals can't add the event directly because that needs permission to change your calendar, which it deliberately never asks for. Dates like `oct 25` make an all-day event.

I tested the date and time reading, the reminders logic, the brief and the `.ics` output with automated tests. I could not test Open-Meteo, ntfy delivery or the new windows in a real browser here.

### 7.14 Settings, search, capture and more

- **Settings window** (`/setup`, owner only): every integration with a green check when it's set up, the variable to set when it isn't, and a **Test** button that tries the connection (Plex, Seerr, Ollama, Trakt, ntfy, Telegram, Whisper, weather, calendar feeds, IMAP). Each card also opens its **settings** so you can fill them in here instead of Portainer (see section 7). Addresses and keys never leave the server. The same window has **Hide secrets** (`/hide`), which blurs share links and server addresses on this device so you can screenshot safely; click into a blurred field to read it.
- **Search** (`/find`, or the Search window): one box over your saved chats, notes, tasks, memories and reminders. Every word you type has to appear; clicking a chat opens it.
- **Quick capture:** message your Telegram bot `note: gate code is 1234`, `todo: call dentist`, `remember: I run Unraid` or `remind me in 1h stretch` and it is saved instead of answered. Notes, tasks and memories appear in the app the next time it's open (checked every minute); reminders are scheduled straight away. From an iPhone share sheet, build a Shortcut with **Get Contents of URL**: `POST` to `https://<your-address>/api/capture`, header `Authorization: Bearer <your Shortcut token>` (the same token as [7.8](#78-iphone-notes--trakt-sync)), JSON body `{"op":"add","text":"<Shortcut Input>"}`. Needs `BUDDY_DATA_DIR`; owner only.
- **Repeating reminders and snooze:** `/remind every monday 9am send report`, `/remind every day 8pm take pills`, `/remind every weekday 7am gym` (also weekly and monthly). When one arrives on your phone, reply `snooze 30m` (or `snooze tomorrow`) to the Telegram bot to be reminded again; in the Tasks window use **+1h**. `/remind snooze 2 1h` snoozes reminder number 2.
- **Weekly review:** `/review` previews your week ahead (calendar by day, reminders, unread mail, a few Trakt picks); `/review send` pushes it. Set `REVIEW_DAY` (for example `sun`) and `REVIEW_TIME` (for example `18:00`) to get it automatically, through the same ntfy/Telegram as the morning brief.
- **Watch queue:** the Today window lists your unwatched Trakt items, ones already in Plex first, each with a one-line reason, and a **Request** button (opens the Seerr request dialog) for ones not in Plex yet.
- **Per-pal memory and saved prompts:** `/remember @byte I use Arch` is known only to Byte; `/memories` shows everything. Built-in prompts (summarize, reply, plan-week, explain, pros-cons, debug) and your own appear in `/prompt` and Ctrl+K and fill the message box.
- **Branching:** use **Branch from here** on any message to continue from that point as a separate saved chat.
- **Backups:** `/backup list` and `/backup restore 2` (or a name). It first saves what's there as `pre-restore-<time>` in the backup folder, asks you to confirm, then copies the backup over your data. Files that exist now but not in the backup are left alone. Restart the container afterwards if anything looks stale.
- **Phones:** the bottom tab bar now scrolls sideways so every window has a button. I couldn't check the layout on a real phone here, so tell me what looks off.
- **Update available:** a blue bar appears at the top (owner only) when GitHub has a newer version than the one running, with **What's new** (the change list) and **Dismiss** (hides that version only). `/update` checks right now. If `NTFY_URL` or Telegram is set, your phone is told once per new version. It compares this build's commit with the repository's `main`; to install, use Portainer → your stack → **Pull and redeploy**. A build with no commit stamp (shown as `local` in the sidebar) can't be compared. `UPDATE_CHECK=0` turns it off.
- **CI:** `.github/workflows/ci.yml` runs the tests and a build on every push to GitHub, so a broken change is flagged before you redeploy.

I tested the logic of all of this with automated tests. I could not run it against real Plex, Seerr, Telegram, ntfy, IMAP or Tailscale, or look at the windows in a browser, so treat the first run as a shakedown.

### 7.15 iPhone Reminders sync (Radicale)

Tasks and reminders can sync **both ways** with the iPhone **Reminders** app. Pixel Pals runs a small CalDAV server (Radicale) next to it, and the iPhone connects to that. Tick something off on your phone and it's done in Pixel Pals, and the other way round; changes arrive within a minute or two without any Shortcut.

**What syncs**
- **Your to-do list** (Tasks window, `/todo`) ⇄ a Reminders list called **Pixel Pals Tasks**: add, finish and delete in either place.
- **Reminders with a time** (`/remind …`) ⇄ a Reminders list called **Pixel Pals Reminders**, with the due time, so your iPhone also alerts at that time. Daily, weekday, weekly and monthly repeats carry over; fancier repeats made on the phone (every 2 weeks, yearly) are left as the phone has them. A one-time reminder you finish on the phone is dropped here, so it won't also push through ntfy.
- If you edit the same item on both sides between syncs, **the phone's version wins**.

**Set it up**
1. In Portainer → your stack → *Environment variables*: add `radicale` to `COMPOSE_PROFILES` (for example `tailscale,radicale`) and set `RADICALE_PASSWORD` to a long password you'll use only for this (optionally `RADICALE_USER`, default `pixelpals`). Redeploy. Pixel Pals finds the server by itself.
2. Make it reachable from your phone over Tailscale (never put it on the open internet):
   - **Tailscale sidecar** (section 3, option 4): already done. The sidecar also serves Radicale at `https://<TS_HOSTNAME>.<your-tailnet>.ts.net:5233`.
   - **Tailscale on the host:** run `sudo tailscale serve --bg --https=5233 http://localhost:5232`. Radicale is published on the host's `127.0.0.1:5232` only (change with `RADICALE_PORT`). Your address is then `https://<host>.<your-tailnet>.ts.net:5233`.
3. Open **Settings** in Pixel Pals and press **Test** next to *Tasks & reminders sync*. It should say Connected.
4. On the iPhone, with Tailscale connected: **Settings → Calendar → Accounts → Add Account → Other → Add CalDAV Account** (on newer iOS: Settings → Apps → Reminders → Accounts). Server: your Tailscale host name, User: `pixelpals` (or your `RADICALE_USER`), Password: your `RADICALE_PASSWORD`. If it can't find the account, open *Advanced* and set SSL on, port `5233`, and Account URL `https://<host>:5233/pixelpals/`. Make sure **Reminders** is switched on for the account. The two lists then appear in the Reminders app.

**Good to know**
- The iPhone syncs only while it can reach the server, so Tailscale must be connected on the phone. Pixel Pals and the server are always in step with each other.
- The Radicale data is its own Docker volume (`radicale-data`) and is not part of Pixel Pals' nightly backup. The password is stored inside the container only, in plain text, which is fine because the server is reachable only through your tailnet.
- Reminders can still push through ntfy or Telegram too. If your iPhone alerts are enough, leave `NTFY_URL` empty to avoid double alerts.
- Items you create in the Reminders app need a **due date and time** to count as reminders in Pixel Pals; items without one appear only in the task list if they are in the *Pixel Pals Tasks* list.
- I tested the format handling and the merge rules with automated tests and against a stand-in CalDAV server that behaves like Radicale. I could not run a real Radicale or an iPhone here, so the first connection is a shakedown. If something doesn't line up, the Setup test message and the `Task sync failed` / `Reminder sync failed` lines in the debug log say what the server answered.

## 8. Automatic jobs

These run on the server at times in `BUDDY_TZ` (default `America/New_York`).

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

### 8.3 Scheduled tasks

Have the pals answer something on a schedule and send the answer to your phone.

```
/schedule add 08:00 weekdays what should I know about today in tech?
/schedule add 18:30 daily is my Unraid array healthy and anything worth watching tonight?
/schedule list
/schedule run 1
/schedule remove 2
```

- Times are 24-hour in `BUDDY_TZ`; days are `daily` (default), `weekdays` or `weekends`. Up to 12 tasks.
- **Owner only**, because tasks run with the owner account's saved settings. Open the room once after adding a key so your settings sync to the server.
- Answers go to your phone through **ntfy** (`NTFY_URL`) and/or **Telegram** ([8.4](#84-telegram-bot)).
- **Only free keys and Local AI are used.** Claude and your Custom provider never run unattended, so nothing can spend money while you're away.
- If a question looks like it needs current facts, the server searches your SearXNG first ([7.1](#71-web-search-searxng)).
- Tasks live in `schedules.json` in the data volume (and are included in backups).

### 8.4 Telegram bot

Message your pals from your phone, anywhere, without opening the website.

1. In Telegram, message **@BotFather**, send `/newbot` and copy the token it gives you.
2. Set `TELEGRAM_BOT_TOKEN` in the stack and redeploy. Message your new bot once: it replies with your **chat id**.
3. Set `TELEGRAM_CHAT_ID` to that number and redeploy. Only that chat is answered; everyone else is ignored.

Then just type a question. `/status` checks your services. It uses long-polling, so you don't need a public address, and like scheduled tasks it only uses free keys and Local AI.

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

The same controls are in the *Fun* window (left menu).

---

## 12. Voice replies and dictation

### 12.1 Voice replies

Click **Voice** in the top bar (or `/voice`) and each discussion's replies are read aloud when it finishes, every pal in a different voice and pitch. The speaker button on any reply reads just that one; `Esc` silences it.

It uses your device's built-in voices: nothing to install, no keys, and no audio data leaves the device. Off by default; synced with your account. On iPhone, Safari only plays sound after you've tapped something on the page (sending a message counts).

### 12.2 Dictation (microphone button)

Speak instead of typing. A small microphone appears next to Send once a speech server is running; tap it, talk, tap again, and the text lands in the message box (nothing is sent automatically).

- The **Whisper** container is part of the stack, so it starts with everything else (*Pull and redeploy* to get it). Nothing leaves your network. Set `WHISPER_REPLICAS=0` if you don't want it running (the mic button then hides itself).
- The first dictation downloads the speech model (`WHISPER_MODEL`, default `Systran/faster-whisper-small`), so allow a minute and try again if it fails once. Use `WHISPER_IMAGE` to pick a different image (for example a GPU build).
- Already have a Whisper server? Set `WHISPER_URL` to it (it must offer `/v1/audio/transcriptions` and `/health`).
- Recordings stop at 60 seconds and are never stored. Browsers only allow the microphone over HTTPS or `localhost` ([section 3](#3-first-run-accounts-and-https)).

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

These are the environment variable names. **Everything marked *(app)* can also be set in the Settings window** (Plex, Seerr, Jellyfin, Trakt, Unraid, ntfy, Telegram, weather, calendar feeds, IMAP, Microsoft 365, brief and review times, backup time and count, time zone, update check). The environment value wins if both are set.

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
| `RADICALE_PASSWORD` / `RADICALE_USER` | empty / `pixelpals` | Turns on the iPhone Reminders sync; also add `radicale` to `COMPOSE_PROFILES` ([7.15](#715-iphone-reminders-sync-radicale)) |
| `RADICALE_URL` / `RADICALE_PORT` | `http://radicale:5232` / `5232` | Only if your calendar server is elsewhere / the host port it is published on |
| `UPDATE_CHECK` | on | `0` turns off the "update available" bar and phone alert ([7.14](#714-settings-search-capture-and-more)) |
| `REVIEW_DAY` / `REVIEW_TIME` | empty (off) | Weekly review: day (`sun`) and time (`18:00`) ([7.14](#714-settings-search-capture-and-more)) |
| `BUDDY_BACKUP_PATH` | volume `buddy-backups` | Host folder for backups |
| `BUDDY_BACKUP_TIME` | `03:30` | Nightly backup time |
| `BUDDY_BACKUP_KEEP` | `14` | Copies to keep |
| `OLLAMA_URL` | `http://ollama:11434` (Portainer stack) | Ollama used by the Local AI engine; empty turns it off |
| `OLLAMA_MODELS` | `qwen2.5:7b nomic-embed-text` | Models downloaded on first start |
| `OLLAMA_RUNTIME` | `runc` | `nvidia` to give Ollama (and hardware detection) the GPU |
| `OLLAMA_PORT` | `11434` | Published Ollama port |
| `ALLOW_PRIVATE_CUSTOM` | empty | `1` lets the Custom provider use private/LAN addresses (http allowed) |
| `PROVIDER_FEED` | `1` | `0` stops the daily fetch of the free-provider list |
| `MODEL_FEED` | `1` | `0` stops the daily check of ollama.com for new models |
| `LOCAL_VRAM_GB` | empty | Your GPU's memory, only if it isn't detected |
| `TRAKT_CLIENT_SECRET` | empty | Only for `/trakt connect` (write access) |
| `WEATHER_LOCATION` / `WEATHER_LAT` / `WEATHER_LON` | empty | Where you are, for `/weather` and the brief ([7.13](#713-today-tasks-weather-and-events)) |
| `WEATHER_UNITS` | `imperial` | `metric` for °C and km/h |
| `CALENDAR_ICS_URLS` | empty | Private .ics links for the Calendar window ([7.12](#712-calendar-and-mail-windows)) |
| `IMAP_HOST` / `IMAP_USER` / `IMAP_PASS` | empty | The Mail window: read, send, move, delete (app password) |
| `SMTP_HOST` / `SMTP_PORT` / `MAIL_FROM_NAME` | guessed / `465` / empty | Sending: server (guessed from the IMAP name), port, and your name on sent mail |
| `M365_CLIENT_ID` / `M365_TENANT` | empty / `organizations` | Microsoft 365 read-only ([7.11](#711-microsoft-365-work-read-only)) |
| `COMPOSE_PROFILES` | empty | `tailscale` starts the Tailscale sidecar |
| `WHISPER_REPLICAS` | `1` | `0` leaves the Whisper container off |
| `TS_AUTHKEY` / `TS_HOSTNAME` | empty / `pixelpals` | Tailscale sidecar ([section 3](#3-first-run-accounts-and-https)) |
| `WHISPER_URL` | `http://whisper:8000` | Speech server for the microphone button |
| `WHISPER_MODEL` / `WHISPER_IMAGE` | small model / CPU image | What the Whisper container runs |
| `TELEGRAM_BOT_TOKEN` / `TELEGRAM_CHAT_ID` | empty | Telegram bot ([8.4](#84-telegram-bot)) |

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

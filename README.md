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
- Optional Google sign-in syncs chats, theme and engine settings across devices. Signed out, everything stays in the browser.

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

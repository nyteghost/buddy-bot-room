# Linux Mode: assistant pals + Terminal pal

## What you get
A new **Linux Mode** theme (dropdown + chat command "Linux Mode" / "Linux Mode Off"). The pals become personal assistants:

| Pal | Linux Mode role | Works in |
|---|---|---|
| Nova | **Gmail pal**: inbox summary, search, draft replies (you approve before sending) | Browser + desktop |
| Byte | **Outlook pal**: same for Outlook mail | Browser + desktop |
| Sage | **Cozi pal**: today's and this week's schedule | Browser + desktop |
| Pip | **Notes pal**: reads/writes notes in a folder you pick | Desktop only |
| Echo | **Files pal**: find files, tidy Downloads (approve each change) | Desktop only |
| Rune | **System pal**: GPU, memory, disk, pending updates (read-only) | Desktop only |
| Claude | **Terminal pal** (penguin sprite) | Desktop only |

## Terminal pal
- A real terminal panel inside the app (your fish shell, full colors, works like Ghostty).
- You type commands yourself as normal.
- When a command fails (error text or non-zero exit), the penguin pops up: "Want help?" and explains the problem and a fix.
- Fixes it suggests appear as a command card with **Run** / **Copy** / **Dismiss**. Nothing runs without your click.
- Risky commands (sudo, rm -rf, dd, mkfs, pacman -R…) are flagged red and need a second confirm.
- You can also ask it anything in a side chat ("why is my wifi dropping?") and it can read recent terminal output to answer.

## Accounts and privacy
- Gmail and Outlook need you signed in with Google first; each account connects its own mailbox, so visitors to the public site never see your mail.
- One-time setup: you create a Google and a Microsoft app login in their developer consoles (I'll give step-by-step) and link them in the workspace connector settings.
- Cozi has no official API. It offers a private **calendar feed link** (Cozi > Settings > Calendar > Share/Export). You paste that link once; it's saved encrypted to your account.

## Limits
- Terminal, notes, files and system stats only work in the desktop app.
- Mail sending, file changes and terminal commands always need your approval.
- I can't test the terminal or desktop parts here; the mail and Cozi parts I can partly test once connected.

## Build order
1. Linux Mode theme, sprites, personas, penguin Terminal pal + terminal panel with error help (desktop).
2. Cozi feed + System/Notes/Files pals.
3. Gmail + Outlook connections (needs your OAuth setup).

## Technical details
- Tauri: add `portable-pty` for a PTY session (`pty_spawn`, `pty_write`, `pty_resize`, events for output/exit), plus `run_command` for approved one-shot commands, `read_dir`/`read_file`/`write_file` scoped to a chosen folder, `system_stats` (nvidia-smi, free, df, checkupdates). Frontend: `@xterm/xterm` + fit addon, loaded client-only.
- Error detection: track exit code via a shell prompt hook (OSC 133) and scan output for error patterns; send last ~80 lines to the Terminal pal through the existing engine (Ollama preferred).
- Pals get tools via AI SDK tool calling for cloud engines; for Ollama/local, a simple JSON action format parsed client-side; every mutating action rendered as an approval card.
- Gmail/Outlook via App User Connectors (`google_mail`, `microsoft_outlook`), connection keys encrypted in a server-only table; server functions with `requireSupabaseAuth`.
- Cozi: server function fetches the ICS feed, parses events; URL encrypted with existing settings crypto.
- New CharacterMode `linux` in hellraiser.ts, persona cast in theme-personas.ts, sprites in themed-sprites.ts.

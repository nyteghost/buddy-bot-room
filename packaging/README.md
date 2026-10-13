# Pixel Pals desktop (CachyOS / Arch)

## Install as a system package (`pacman`)
```bash
git clone https://github.com/nyteghost/buddy-bot-room.git
cd buddy-bot-room/packaging/arch
makepkg -si          # builds and installs with pacman
```
Afterwards: `pixelpals` from Ghostty, or "Pixel Pals" in your app launcher.
Remove with `sudo pacman -R pixelpals`.

## Build an AppImage
```bash
bun install
bun run tauri:icons
bun run tauri:build     # output: src-tauri/target/release/bundle/appimage/
```

## Develop locally (window shows your local dev server)
```bash
bun run tauri:dev
```

## Ollama
```bash
ollama pull qwen2.5:7b
OLLAMA_ORIGINS="*" ollama serve
```
Then pick "Local Server / Ollama" in the AI engine settings.

Note: the release window loads the published app; the Ollama connection still runs on your own GPU.

# Pixel Pals desktop (CachyOS / Arch)

## Clone
GitHub doesn't accept account passwords in the terminal. Log in once first:
```bash
sudo pacman -S github-cli
gh auth login
gh repo clone nyteghost/buddy-bot-room
cd buddy-bot-room
```

## One-step install (any shell, including fish)
```bash
bash packaging/install.sh
```
Installs missing tools, sets up Rust, fixes icons, builds, and adds Pixel Pals
to your app menu and desktop. Then right-click it in the menu → Add to Favorites.

## Or as a pacman package
```bash
cd packaging/arch
makepkg -si
```
Builds from your local copy (no GitHub login). Remove with `sudo pacman -R pixelpals`.

## AppImage
After building: `src-tauri/target/release/bundle/appimage/`

## Ollama
```bash
ollama pull qwen2.5:7b
OLLAMA_ORIGINS="*" ollama serve
```
Run these separately, then pick "Local Server / Ollama" in the AI engine settings.

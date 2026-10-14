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

## Update later
```bash
cd ~/buddy-bot-room
bash packaging/install.sh
```
That one command fetches the newest code from GitHub, rebuilds, and reinstalls.
The app's own update popup runs exactly this. To only fetch code (no rebuild):
`bash packaging/pull.sh`. If your own edits are in the way, the script says so —
keep them with `git stash`, or take GitHub's copy with
`FORCE=1 bash packaging/pull.sh`.


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

#!/usr/bin/env bash
# Pixel Pals installer for Arch / CachyOS. Works from any shell (fish, zsh, bash):
#   bash packaging/install.sh
set -euo pipefail
cd "$(dirname "$0")/.."

need() { command -v "$1" >/dev/null 2>&1; }
missing=()
need bun || missing+=(bun)
need rustup || need cargo || missing+=(rustup)
python3 -c "import PIL" 2>/dev/null || missing+=(python-pillow)
pacman -Q webkit2gtk-4.1 >/dev/null 2>&1 || missing+=(webkit2gtk-4.1)
if ((${#missing[@]})); then
  echo "==> Installing: ${missing[*]}"
  sudo pacman -S --needed --noconfirm "${missing[@]}"
fi

if ! cargo --version >/dev/null 2>&1; then
  echo "==> Setting default Rust toolchain"
  rustup default stable
fi

echo "==> Making icons RGBA"
python3 - <<'PY'
import os
from PIL import Image
d = "src-tauri/icons"
for f in os.listdir(d):
    if f.endswith(".png"):
        p = os.path.join(d, f)
        Image.open(p).convert("RGBA").save(p)
PY

echo "==> Building (first build takes a few minutes)"
bun install
bunx tauri build --bundles deb,appimage

echo "==> Installing"
sudo install -Dm755 src-tauri/target/release/pixelpals /usr/local/bin/pixelpals
install -Dm644 src-tauri/icons/128x128.png ~/.local/share/icons/hicolor/128x128/apps/pixelpals.png
install -Dm644 packaging/pixelpals.desktop ~/.local/share/applications/pixelpals.desktop
desk="$(xdg-user-dir DESKTOP 2>/dev/null || echo "$HOME/Desktop")"
mkdir -p "$desk"
install -Dm755 packaging/pixelpals.desktop "$desk/pixelpals.desktop"
gio set "$desk/pixelpals.desktop" metadata::trusted true 2>/dev/null || true
update-desktop-database ~/.local/share/applications 2>/dev/null || true

echo "==> Done. Launch 'Pixel Pals' from your app menu or desktop, or run: pixelpals"
echo "    To pin it: open your app menu, right-click Pixel Pals, Add to Favorites."

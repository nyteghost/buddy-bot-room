#!/usr/bin/env bash
# Run once: bash tools/auto-deploy/install.sh   (asks you to paste the Portainer webhook URL; it is not shown or logged)
set -euo pipefail
here="$(cd "$(dirname "$0")" && pwd)"
mkdir -p "$HOME/.config/pixelpals" "$HOME/.config/systemd/user" "$HOME/.local/bin"
if [ -s "$HOME/.config/pixelpals/webhook" ]; then
  echo "Keeping the saved Portainer webhook URL."
else
  read -rsp "Paste the Portainer webhook URL, then press Enter: " u; echo
  umask 077; printf '%s\n' "$u" > "$HOME/.config/pixelpals/webhook"
fi
read -rsp "Paste your ntfy topic link for failure alerts (or just press Enter to skip / keep the saved one): " n; echo
if [ -n "$n" ]; then umask 077; printf '%s\n' "$n" > "$HOME/.config/pixelpals/ntfy"; fi
install -m 755 "$here/pixelpals-autodeploy.sh" "$HOME/.local/bin/pixelpals-autodeploy"
cat > "$HOME/.config/systemd/user/pixelpals-autodeploy.service" <<S
[Unit]
Description=Redeploy Pixel Pals when main changes
[Service]
Type=oneshot
ExecStart=%h/.local/bin/pixelpals-autodeploy
S
cat > "$HOME/.config/systemd/user/pixelpals-autodeploy.timer" <<S
[Unit]
Description=Check for new Pixel Pals commits
[Timer]
OnBootSec=2min
OnUnitActiveSec=3min
[Install]
WantedBy=timers.target
S
systemctl --user daemon-reload && systemctl --user enable --now pixelpals-autodeploy.timer
echo "Auto-deploy on. Checks every 3 minutes. Logs: journalctl --user -u pixelpals-autodeploy"

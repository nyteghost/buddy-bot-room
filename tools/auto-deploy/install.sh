#!/usr/bin/env bash
# Run once: bash tools/auto-deploy/install.sh   (asks you to paste the Portainer webhook URL; it is not shown or logged)
set -euo pipefail
here="$(cd "$(dirname "$0")" && pwd)"
mkdir -p "$HOME/.config/pixelpals" "$HOME/.config/systemd/user" "$HOME/.local/bin"
read -rsp "Paste the Portainer webhook URL, then press Enter: " u; echo
umask 077; printf '%s\n' "$u" > "$HOME/.config/pixelpals/webhook"
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

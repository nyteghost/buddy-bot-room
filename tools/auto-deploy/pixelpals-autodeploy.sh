#!/usr/bin/env bash
# Calls the Portainer stack webhook when `main` has a new commit. The webhook URL stays in ~/.config/pixelpals/webhook (chmod 600).
set -euo pipefail
cfg="$HOME/.config/pixelpals"; mkdir -p "$cfg"
url="$(tr -d '[:space:]' < "$cfg/webhook")"
head="$(git ls-remote https://github.com/nyteghost/buddy-bot-room refs/heads/main | cut -f1)"
[ -n "$head" ] || exit 0
[ "$head" = "$(cat "$cfg/last" 2>/dev/null || true)" ] && exit 0
curl -ksS -o /dev/null -w '%{http_code}' -X POST "$url" | grep -q '^2' && echo "$head" > "$cfg/last" && echo "deployed $head"

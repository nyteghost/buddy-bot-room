#!/usr/bin/env bash
# Runs every few minutes: redeploys when `main` has a new commit, checks that the app answers afterwards, and tells your
# phone (ntfy) if a deploy fails or the app stops answering. Secrets stay in ~/.config/pixelpals (chmod 600):
#   webhook = Portainer stack webhook URL     ntfy = your ntfy topic link (optional)
set -uo pipefail
cfg="$HOME/.config/pixelpals"; mkdir -p "$cfg"
app="${PIXELPALS_URL:-http://localhost:8090}"
alert() { [ -s "$cfg/ntfy" ] && curl -fsS -m 10 -H "Title: $1" -d "$2" "$(tr -d '[:space:]' < "$cfg/ntfy")" >/dev/null 2>&1 || true; }
healthy() { curl -fsS -m 8 "$app/__health" >/dev/null 2>&1; }

url="$(tr -d '[:space:]' < "$cfg/webhook")"
head="$(git ls-remote https://github.com/nyteghost/buddy-bot-room refs/heads/main | cut -f1)"
if [ -n "$head" ] && [ "$head" != "$(cat "$cfg/last" 2>/dev/null || true)" ]; then
  code="$(curl -ksS -o /dev/null -w '%{http_code}' -X POST "$url" || echo 000)"
  if [[ "$code" == 2* ]]; then
    echo "$head" > "$cfg/last"; echo "deploying ${head:0:7}"
    ok=0; for _ in $(seq 1 60); do sleep 10; if healthy; then ok=1; break; fi; done
    if [ "$ok" = 1 ]; then echo 0 > "$cfg/down"; echo "deployed ${head:0:7}"
    else alert "Pixel Pals deploy failed" "Version ${head:0:7} did not come up within 10 minutes. Check Portainer."; fi
  else
    alert "Pixel Pals deploy not started" "Portainer's webhook answered $code for ${head:0:7}."
  fi
  exit 0
fi

# Nothing to deploy: just make sure it is up. Two checks in a row (about 6 minutes) before alerting, and only once per outage.
if healthy; then
  if [ "$(cat "$cfg/down" 2>/dev/null || echo 0)" -ge 2 ]; then alert "Pixel Pals is back" "It answers again."; fi
  echo 0 > "$cfg/down"
else
  n=$(( $(cat "$cfg/down" 2>/dev/null || echo 0) + 1 )); echo "$n" > "$cfg/down"
  [ "$n" = 2 ] && alert "Pixel Pals is not answering" "$app has not answered for about 6 minutes."
fi
exit 0

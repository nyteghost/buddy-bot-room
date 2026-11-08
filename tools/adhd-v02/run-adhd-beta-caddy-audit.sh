#!/usr/bin/env bash
# Read-only, secret-redacting structural audit of the running ADHD Caddy proxy.
# No docker restarts, config edits, uploaded photos, or private key output.
set -Eeuo pipefail
set +x

PINNED="8d9c06cd99daba2f83b1b1e0db1faffeeb493ac1"
SOURCE="https://raw.githubusercontent.com/nyteghost/buddy-bot-room/$PINNED/tools/adhd-v02/audit-adhd-beta-caddy.py"
IMAGE="python:3.12-alpine"
STAGE=''

cleanup() {
  if [[ -n "$STAGE" && -d "$STAGE" ]]; then rm -rf -- "$STAGE"; fi
}
trap cleanup EXIT

for cmd in docker curl mktemp; do
  command -v "$cmd" >/dev/null 2>&1 || { echo "REFUSED: missing $cmd"; exit 1; }
done
docker container inspect adhd-assistant-lan >/dev/null 2>&1 ||
  { echo 'REFUSED: existing Caddy container missing'; exit 1; }
docker image inspect "$IMAGE" >/dev/null 2>&1 ||
  { echo 'REFUSED: local Python image missing; nothing downloaded'; exit 1; }

echo 'Read-only Caddy proxy inventory: names/credentials/certificates remain hidden.'
echo 'No routes, listeners, Docker containers, services or secrets are changed.'
printf 'Caddy version: '
docker exec adhd-assistant-lan caddy version | head -n 1

STAGE="$(mktemp -d /tmp/adhd-beta-caddy-audit.XXXXXXXX)"
chmod 755 "$STAGE"
curl -fsSL --connect-timeout 10 --max-time 40 --retry 2 \
  -o "$STAGE/audit.py" "$SOURCE"
chmod 444 "$STAGE/audit.py"

# Caddy adapted JSON includes sensitive hashes and secret header values.
# It stays in an in-memory pipe and MUST NOT be printed, tee'd or saved.
docker exec adhd-assistant-lan caddy adapt \
  --config /etc/caddy/Caddyfile 2>/dev/null \
  | docker run --rm --pull never -i --network none --read-only \
      --user 99:100 --cap-drop ALL --security-opt no-new-privileges \
      --pids-limit 64 --memory 256m \
      --mount "type=bind,src=$STAGE,dst=/checks,readonly" \
      "$IMAGE" python -B /checks/audit.py
echo 'Audit complete. HTTPS certificate trust and real browser auth are NOT verified.'

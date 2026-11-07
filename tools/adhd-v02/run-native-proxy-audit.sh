#!/usr/bin/env bash
# Read-only examination of Caddy's ADAPTED routes. No installation or restart.
# Full JSON (possibly containing private hashes) stays in a local pipe.
set -Eeuo pipefail

HOST="tower.tarpon-drum.ts.net"
if [ "$#" -ge 1 ]; then HOST="$1"; fi
IMAGE="python:3.12-alpine"
SOURCE_SHA="3bc95671723616aee98252ed0f5379f139d96dd7"
SOURCE="https://raw.githubusercontent.com/nyteghost/buddy-bot-room/$SOURCE_SHA/tools/adhd-v02/audit_native_review_proxy.py"

if [[ "$HOST" == *"/"* || "$HOST" == *":"* || -z "$HOST" ]]; then
  echo "REFUSED: supply only a browser hostname, without scheme or port." >&2
  exit 1
fi
for binary in docker curl; do
  command -v "$binary" >/dev/null 2>&1 || {
    echo "REFUSED: missing required local command." >&2
    exit 1
  }
done
docker inspect adhd-assistant-lan >/dev/null 2>&1 || {
  echo "REFUSED: existing Caddy container not found." >&2
  exit 1
}
docker image inspect "$IMAGE" >/dev/null 2>&1 || {
  echo "REFUSED: existing Python image not found; no image will be pulled." >&2
  exit 1
}
STAGE="$(mktemp -d /tmp/adhd-caddy-audit.XXXXXX)"
trap 'rm -rf -- "$STAGE"' EXIT
chmod 0755 "$STAGE"
curl --fail --silent --show-error --location --connect-timeout 10 \
  --retry 2 "$SOURCE" --output "$STAGE/audit_native_review_proxy.py"
chmod 0444 "$STAGE/audit_native_review_proxy.py"

echo "Inspecting Caddy's effective route structure (read-only)."
echo "No credentials, local session token, application data, or passwords printed."
echo "No new port, application installation, container restart, or configuration change."
# Do NOT add tee, set -x, or logging to this pipeline. Adapted JSON may
# contain private Basic Auth password hashes and secret header values.
docker exec adhd-assistant-lan caddy adapt \
  --config /etc/caddy/Caddyfile 2>/dev/null \
  | docker run --rm --pull never -i --network none --read-only \
      --user 99:100 --cap-drop ALL --security-opt no-new-privileges \
      --pids-limit 64 --memory 256m \
      --env PYTHONDONTWRITEBYTECODE=1 \
      --mount "type=bind,src=$STAGE,dst=/checks,readonly" \
      "$IMAGE" python -B /checks/audit_native_review_proxy.py --host "$HOST"
echo "Static inspection finished. Browser access and installation remain unverified."

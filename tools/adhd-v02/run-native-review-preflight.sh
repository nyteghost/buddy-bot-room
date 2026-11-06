#!/usr/bin/env bash
# Read-only compatibility inspection of the installed ADHD Assistant server.
# This is NOT an inbox installer; it never mounts /data or changes Caddy.
set -Eeuo pipefail

CODE_ROOT="/mnt/user/appdata/adhd-assistant/code"
SOURCE_SHA="0b9ab875b5a3aff8f25c78678843a5b65f368ea4"
BASE="https://raw.githubusercontent.com/nyteghost/buddy-bot-room/$SOURCE_SHA/tools/adhd-v02"
IMAGE="python:3.12-alpine"

[ -f "$CODE_ROOT/adhd_assistant/server.py" ] || {
  echo "REFUSED: installed ADHD server.py not found" >&2; exit 1;
}
for tool in curl docker; do
  command -v "$tool" >/dev/null 2>&1 || {
    echo "REFUSED: missing $tool" >&2; exit 1;
  }
done
docker image inspect "$IMAGE" >/dev/null 2>&1 || {
  echo "REFUSED: existing Python runtime image unavailable; no auto-pull" >&2; exit 1;
}

STAGE_DIR="$(mktemp -d /tmp/adhd-inbox-source-check.XXXXXX)"
trap 'rm -rf -- "$STAGE_DIR"' EXIT
chmod 0755 "$STAGE_DIR"
for file in prepare-native-review-patch.py approved_task_export.py native_local_intake.py \
            native_review_inbox.py native_review_http.py native_review_page.html; do
  curl --fail --show-error --silent --location --connect-timeout 10 \
    --retry 2 "$BASE/$file" --output "$STAGE_DIR/$file"
done
chmod 0444 "$STAGE_DIR"/*

echo "Checking native ADHD browser-route compatibility (read-only)..."
echo "No network, no live data mount, no Caddy changes, no installation."
docker run --rm --pull never --network none --read-only \
  --user 99:100 --cap-drop ALL --security-opt no-new-privileges \
  --pids-limit 64 --memory 256m \
  --tmpfs /tmp:rw,nosuid,nodev,size=32m,mode=1777 \
  --env PYTHONDONTWRITEBYTECODE=1 \
  --mount "type=bind,src=$CODE_ROOT,dst=/opt/adhd,readonly" \
  --mount "type=bind,src=$STAGE_DIR,dst=/checks,readonly" \
  "$IMAGE" python -B /checks/prepare-native-review-patch.py \
  --source-root /opt/adhd
echo "Read-only native browser-route inspection completed."

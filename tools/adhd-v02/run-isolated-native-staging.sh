#!/usr/bin/env bash
# One-time OFFLINE rehearsal against the installed ADHD Store code with
# synthetic temporary data only. NO live database, token or memory is mounted.
set -Eeuo pipefail

CODE_ROOT="/mnt/user/appdata/adhd-assistant/code"
SOURCE_SHA="cffd24659622080dcb64dbc27c00efd321eed6f3"
BASE="https://raw.githubusercontent.com/nyteghost/buddy-bot-room/$SOURCE_SHA/tools/adhd-v02"
IMAGE="python:3.12-alpine"

if [[ ! -f "$CODE_ROOT/adhd_assistant/database.py" ]]; then
  echo "REFUSED: installed ADHD source directory was not found." >&2
  exit 1
fi
if ! command -v curl >/dev/null || ! command -v docker >/dev/null; then
  echo "REFUSED: curl and Docker are required." >&2
  exit 1
fi
if ! docker image inspect "$IMAGE" >/dev/null 2>&1; then
  echo "REFUSED: the existing $IMAGE Docker image is required (no auto-pull)." >&2
  exit 1
fi

STAGING_DIR="$(mktemp -d /tmp/adhd-native-offline.XXXXXX)"
trap 'rm -rf -- "$STAGING_DIR"' EXIT
# The scripts are public-source files; allow unprivileged container UID to read.
chmod 0755 "$STAGING_DIR"
for file in approved_task_export.py native_local_intake.py stage_native_local_intake.py; do
  curl --fail --show-error --silent --location --retry 2 --connect-timeout 10 \
    "$BASE/$file" -o "$STAGING_DIR/$file"
done
chmod 0444 "$STAGING_DIR"/*.py

echo "ADHD native task staging check (synthetic data only)."
echo "No user database mounted. Container networking disabled. No installation."

docker run --rm --pull never \
  --network none --read-only --user 99:100 --cap-drop ALL \
  --security-opt no-new-privileges --pids-limit 64 --memory 256m \
  --tmpfs /tmp:rw,nosuid,nodev,size=64m,mode=1777 \
  --env ADHD_STAGING_ONLY=1 \
  --env PYTHONDONTWRITEBYTECODE=1 \
  --env PYTHONPATH=/opt/adhd:/checks \
  --mount "type=bind,src=$CODE_ROOT,dst=/opt/adhd,readonly" \
  --mount "type=bind,src=$STAGING_DIR,dst=/checks,readonly" \
  "$IMAGE" python -B /checks/stage_native_local_intake.py

echo "Staging container exited and synthetic databases were discarded."

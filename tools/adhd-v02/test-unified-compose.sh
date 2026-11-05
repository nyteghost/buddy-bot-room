#!/usr/bin/env bash
# Validate the actual embedded migration template without Docker daemon, root, or live Unraid.
set -Eeuo pipefail
SELF="$(cd "$(dirname "$0")" && pwd)"
TEMPDIR="$(mktemp -d)"
trap 'rm -rf -- "$TEMPDIR"' EXIT
cat > "$TEMPDIR/docker-compose.yml" <<'COMPOSE'
name: pixelpals
services:
  buddy-bot:
    image: ghcr.io/nyteghost/buddy-bot-room:beta
    container_name: buddy-bot-room
    ports:
      - "8090:8090"
    environment:
      BUDDY_ACCOUNTS: "1"
      BUDDY_BACKUP_DIR: /backups
    volumes:
      - /mnt/user/appdata/pixelpals/data:/data
    extra_hosts:
      - host.docker.internal:host-gateway
  whisper:
    image: ghcr.io/speaches-ai/speaches:latest-cpu
volumes:
  keep-me: {}
COMPOSE
# Extract the awk code actually used by the installer. Tests will fail if it moves/changes.
python3 - "$SELF/install-unified-stack.sh" "$TEMPDIR/render.sh" <<'PY'
from pathlib import Path
import sys
s=Path(sys.argv[1]).read_text()
a=s.index('awk -v buddy="$BUDDY_SERVICE"')
needle="' \"$COMPOSE_FILE\" > \"$STAGED\""
b=s.index(needle,a)+len(needle)
header='''#!/usr/bin/env bash
set -Eeuo pipefail
BUDDY_SERVICE=buddy-bot
DATA=/mnt/user/appdata/adhd-assistant/data
APP=/mnt/user/appdata/adhd-assistant/code
COMPOSE_FILE="$1"
STAGED="$2"
'''
Path(sys.argv[2]).write_text(header+s[a:b]+'\n')
PY
bash "$TEMPDIR/render.sh" "$TEMPDIR/docker-compose.yml" "$TEMPDIR/unified.yml"
docker compose -p pixelpals -f "$TEMPDIR/unified.yml" config --quiet
# Config must retain the original service/data and add the new service/secret.
docker compose -p pixelpals -f "$TEMPDIR/unified.yml" config --format json | python3 -c '
import json,sys
c=json.load(sys.stdin)["services"]
assert {"buddy-bot","whisper","adhd-assistant"} <= set(c)
a=c["adhd-assistant"]
assert a["network_mode"]=="host"
assert a["read_only"] is True
assert any(v["target"]=="/data" for v in a["volumes"])
b=c["buddy-bot"]
assert b["environment"]["ADHD_BRIDGE_ENABLED"]=="1"
assert b["environment"]["ADHD_BRIDGE_PEER_URL"]=="http://host.docker.internal:18766"
assert any(v["target"]=="/run/secrets/adhd_bridge_token" and v["read_only"] for v in b["volumes"])
assert any(v["target"]=="/data" for v in b["volumes"])
print("PASS: unified Compose keeps original services, mounts and secrets")
'
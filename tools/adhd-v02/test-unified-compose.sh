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
# Simulate an actual Compose Manager two-file project: retain the ordered override.
cat > "$TEMPDIR/docker-compose.override.yml" <<'OVERRIDE'
services:
  buddy-bot:
    environment:
      OTHER_SETTING_FROM_OVERRIDE: "untouched"
  auxiliary-service:
    image: busybox:latest
OVERRIDE
bash "$TEMPDIR/render.sh" "$TEMPDIR/docker-compose.yml" "$TEMPDIR/unified.yml"
docker compose -p pixelpals -f "$TEMPDIR/unified.yml" -f "$TEMPDIR/docker-compose.override.yml" config --quiet
# Config must retain the original service/data and add the new service/secret.
docker compose -p pixelpals -f "$TEMPDIR/unified.yml" -f "$TEMPDIR/docker-compose.override.yml" config --format json | python3 -c '
import json,sys
c=json.load(sys.stdin)["services"]
assert {"buddy-bot","whisper","adhd-assistant","auxiliary-service"} <= set(c)
a=c["adhd-assistant"]
assert a["network_mode"]=="host"
assert a["read_only"] is True
assert any(v["target"]=="/data" for v in a["volumes"])
b=c["buddy-bot"]
assert b["environment"]["ADHD_BRIDGE_ENABLED"]=="1"
assert b["environment"]["OTHER_SETTING_FROM_OVERRIDE"]=="untouched"
assert b["environment"]["ADHD_BRIDGE_PEER_URL"]=="http://host.docker.internal:18766"
assert any(v["target"]=="/run/secrets/adhd_bridge_token" and v["read_only"] for v in b["volumes"])
assert any(v["target"]=="/data" for v in b["volumes"])
print("PASS: unified multi-file Compose retains overrides, services, mounts and secrets")
'
# Extract the very source-file selection used by the installer and check that only
# the base YAML (not the unrelated override) is chosen for the edit.
python3 - "$SELF/install-unified-stack.sh" "$TEMPDIR/select.sh" <<'PY'
from pathlib import Path
import sys
source=Path(sys.argv[1]).read_text()
start=source.index('COMPOSE_FILE=""\nOWNERS=0\n')
end=source.index('cd "$COMPOSE_DIR"', start)
Path(sys.argv[2]).write_text("""#!/usr/bin/env bash
set -Eeuo pipefail
BUDDY_SERVICE=buddy-bot
COMPOSE_FILES=("$1" "$2")
fail(){ echo "$*" >&2; exit 1; }
"""+source[start:end]+'printf "%s\\n" "$COMPOSE_FILE"\n')
PY
selected="$(bash "$TEMPDIR/select.sh" "$TEMPDIR/docker-compose.yml" "$TEMPDIR/docker-compose.override.yml")"
[ "$selected" = "$TEMPDIR/docker-compose.yml" ] || { echo 'Unsafe multi-file edit target' >&2; exit 1; }
echo 'PASS: multi-file selection edits only the owning Compose source'

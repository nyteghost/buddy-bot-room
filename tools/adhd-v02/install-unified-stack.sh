#!/usr/bin/env bash
# Pixel Pals + ADHD-A v0.2 Unraid unified Compose migration.
# Operates only on a verified existing Pixel Pals Compose project and ADHD v0.1/v0.2 install.
# Does not run docker compose down, remove volumes, replace Caddy, or touch GitHub main.
set -Eeuo pipefail

REPO='nyteghost/buddy-bot-room'
OVERLAY_COMMIT='a52d21d3b39d50521aed0290eb9fbfb680fa6efe'
OVERLAY_URL="https://raw.githubusercontent.com/$REPO/$OVERLAY_COMMIT/tools/adhd-v02/install-bridge-overlay.sh"
BASE='/mnt/user/appdata/adhd-assistant'
APP="$BASE/code"
DATA="$BASE/data"
CONTAINER='adhd-assistant'
PIXEL_CONTAINER='buddy-bot-room'
IMAGE='ghcr.io/nyteghost/buddy-bot-room:beta'
PORT=18766
MODE="${1:---plan}"

say(){ printf '\n[Pixel Pals + ADHD-A] %s\n' "$*"; }
fail(){ printf '\n[Pixel Pals + ADHD-A] ERROR: %s\n' "$*" >&2; exit 1; }
[ "$MODE" = '--plan' ] || [ "$MODE" = '--install' ] || fail 'Usage: bash install-unified-stack.sh --plan|--install'
[ "$(id -u)" -eq 0 ] || fail 'Run in an Unraid root terminal.'
for bin in docker awk grep curl mktemp sed cp; do command -v "$bin" >/dev/null 2>&1 || fail "Missing $bin"; done
docker compose version >/dev/null 2>&1 || fail 'Docker Compose v2 is required.'
docker inspect "$PIXEL_CONTAINER" >/dev/null 2>&1 || fail 'Pixel Pals container not found.'
docker inspect "$CONTAINER" >/dev/null 2>&1 || fail 'ADHD-A container not found.'
[ "$(docker inspect -f '{{.State.Running}}' "$PIXEL_CONTAINER")" = true ] || fail 'Pixel Pals is not running.'
[ "$(docker inspect -f '{{.State.Running}}' "$CONTAINER")" = true ] || fail 'ADHD-A is not running.'
[ "$(docker inspect -f '{{.HostConfig.NetworkMode}}' "$CONTAINER")" = host ] || fail 'The installed ADHD-A network layout is not the known host mode.'

PROJECT="$(docker inspect -f '{{index .Config.Labels "com.docker.compose.project"}}' "$PIXEL_CONTAINER")"
BUDDY_SERVICE="$(docker inspect -f '{{index .Config.Labels "com.docker.compose.service"}}' "$PIXEL_CONTAINER")"
FILES="$(docker inspect -f '{{index .Config.Labels "com.docker.compose.project.config_files"}}' "$PIXEL_CONTAINER")"
[[ "$PROJECT" =~ ^[a-zA-Z0-9_-]+$ && "$BUDDY_SERVICE" =~ ^[a-zA-Z0-9_-]+$ ]] || fail 'Cannot identify the running Pixel Pals Compose project safely.'
if [[ "$FILES" == *','* || "$FILES" == '<no value>' || "$FILES" == *$'\n'* ]]; then
  fail 'Pixel Pals has a multi-file or unknown Compose configuration. Refusing automatic modification.'
fi
COMPOSE_FILE="$FILES"
if [ ! -f "$COMPOSE_FILE" ]; then
  FALLBACK="/boot/config/plugins/compose.manager/projects/$PROJECT/docker-compose.yml"
  [ -f "$FALLBACK" ] || fail 'Cannot find the active Compose Manager file.'
  COMPOSE_FILE="$FALLBACK"
fi
[[ "$COMPOSE_FILE" == /boot/config/plugins/compose.manager/projects/*/docker-compose.y*ml ]] || fail 'Unexpected Compose path outside Unraid Compose Manager; refusing automatic modification.'
[ ! -L "$COMPOSE_FILE" ] || fail 'Compose file is a symbolic link; refusing unsafe edit.'
[[ "$PROJECT" == pixelpals || "$PROJECT" == pixelpals-beta ]] || fail 'Unrecognized project name. Refusing to touch unrelated Compose projects.'
COMPOSE_DIR="$(dirname "$COMPOSE_FILE")"
cd "$COMPOSE_DIR"
[[ "$(docker inspect -f '{{.Config.Image}}' "$PIXEL_CONTAINER")" == "$IMAGE" ]] || fail 'Pixel Pals is not using the beta image expected for this installation.'
ORIGINAL_PIXEL_IMAGE_ID="$(docker inspect -f '{{.Image}}' "$PIXEL_CONTAINER")"

[ -f "$APP/launch.py" ] && [ -f "$APP/pyproject.toml" ] && [ -f "$APP/adhd_assistant/server.py" ] || fail 'Expected ADHD-A source files are missing.'
[ -d "$DATA" ] || fail 'ADHD-A persistent data folder is missing.'
MOUNTS="$(docker inspect -f '{{range .Mounts}}{{println .Source "->" .Destination}}{{end}}' "$CONTAINER")"
grep -Fq "$APP -> /opt/adhd" <<<"$MOUNTS" || fail 'ADHD-A application mount differs from known layout.'
grep -Fq "$DATA -> /data" <<<"$MOUNTS" || fail 'ADHD-A data mount differs from known layout.'
[[ "$(docker inspect -f '{{.Config.Image}}' "$CONTAINER")" == 'python:3.12-alpine' ]] || fail 'ADHD-A Python runtime differs from known layout.'
[[ "$(docker inspect -f '{{.Config.User}}' "$CONTAINER")" == '99:100' ]] || fail 'ADHD-A user differs from known layout.'
[[ "$(docker inspect -f '{{.HostConfig.ReadonlyRootfs}}' "$CONTAINER")" == true ]] || fail 'ADHD-A root filesystem differs from known layout.'
NETWORK="${PROJECT}_default"
NETINFO="$(docker network inspect "$NETWORK" --format '{{range .IPAM.Config}}{{println .Subnet " " .Gateway}}{{end}}' 2>/dev/null | head -n 1 || true)"
read -r CIDR GATEWAY <<< "$NETINFO"
[[ "$CIDR" =~ ^(10\.|172\.|192\.168\.)[0-9.]+/[0-9]+$ && "$GATEWAY" =~ ^[0-9.]+$ ]] || fail 'Cannot find the expected private Pixel Pals gateway.'
docker inspect -f '{{range .HostConfig.ExtraHosts}}{{println .}}{{end}}' "$PIXEL_CONTAINER" | grep -q '^host.docker.internal:' || fail 'Pixel Pals has no host.docker.internal mapping.'

docker compose -p "$PROJECT" -f "$COMPOSE_FILE" config --quiet || fail 'Existing Compose file failed validation.'
docker compose -p "$PROJECT" -f "$COMPOSE_FILE" config --images | grep -Fxq "$IMAGE" || fail 'The active Compose configuration does not reference the expected Pixel Pals beta image.'
if docker compose -p "$PROJECT" -f "$COMPOSE_FILE" config --services | grep -qx "$CONTAINER"; then
  say 'ADHD-A already appears in this Compose project. No changes made.'
  docker compose -p "$PROJECT" -f "$COMPOSE_FILE" ps "$CONTAINER" || true
  exit 0
fi
[[ "$(grep -Ec '^services:[[:space:]]*$' "$COMPOSE_FILE")" == 1 ]] || fail 'Expected one top-level services: block.'
[[ "$(grep -Ec "^  ${BUDDY_SERVICE}:[[:space:]]*(#.*)?$" "$COMPOSE_FILE")" == 1 ]] || fail 'Cannot uniquely locate the active Pixel Pals service in YAML.'
if grep -Eq 'ADHD_BRIDGE_(ENABLED|PEER_TOKEN|PEER_URL|ALLOW_DOCKER_HOST)' "$COMPOSE_FILE"; then
  fail 'Existing bridge settings found. Merge requires manual review; nothing changed.'
fi
if [ ! -f "$APP/adhd_assistant/bridge_v02.py" ] && ! grep -Eq '^version[[:space:]]*=[[:space:]]*"0\.1\.0"' "$APP/pyproject.toml"; then
  fail 'ADHD-A is not a recognized v0.1 install and has no v0.2 bridge. Nothing changed.'
fi

say "Compose project: $PROJECT; Pixel Pals service: $BUDDY_SERVICE"
say "Compose file: $COMPOSE_FILE"
say "Docker network: $NETWORK ($CIDR; gateway $GATEWAY)"
say "ADHD-A source: $APP; data: $DATA"
say 'The existing Caddy container will stay outside this stack and remain untouched.'
if [ "$MODE" = '--plan' ]; then
  say 'PLAN ONLY: install v0.2 receiver if required, adopt ADHD-A into this Compose project, add private bridge secret mount and configuration to Pixel Pals. No changes made.'
  exit 0
fi

# Preflight a beta image with support for read-only token-file credentials, before touching running containers.
say 'Downloading current beta image and checking token-file bridge support.'
docker pull "$IMAGE" >/dev/null || fail 'Cannot pull the Pixel Pals beta image.'
docker run --rm --network none --entrypoint sh "$IMAGE" -c 'grep -q ADHD_BRIDGE_PEER_TOKEN_FILE /app/src/lib/adhd-bridge.server.ts' || fail 'The published beta image lacks the new token-file bridge support. Nothing has been migrated.'

# Upgrade the known v0.1 ADHD receiver. This preserves /data and the existing container;
# it uses its own safe source rollback if receiver startup fails.
if ! grep -Fq '# ADHD_BRIDGE_V02_START' "$APP/launch.py"; then
  say 'Upgrading ADHD-A v0.1 to the v0.2 bridge-enabled runtime.'
  TEMP_OVERLAY="$(mktemp)"
  trap 'rm -f -- "${TEMP_OVERLAY:-}"' EXIT
  curl -fsSL --retry 2 --proto '=https' --tlsv1.2 "$OVERLAY_URL" -o "$TEMP_OVERLAY" || fail 'Could not fetch the pinned v0.2 upgrade script.'
  bash -n "$TEMP_OVERLAY" || fail 'Upgrade script failed shell validation.'
  bash "$TEMP_OVERLAY" || fail 'v0.2 upgrade failed, original Compose project unchanged.'
  rm -f -- "$TEMP_OVERLAY"; TEMP_OVERLAY=''
  trap - EXIT
fi
[ -f "$DATA/bridge-v02-token" ] && [ -f "$DATA/bridge-v02.json" ] || fail 'v0.2 receiver secret and configuration were not created.'
[ "$(curl -sS --max-time 4 --noproxy '*' -o /dev/null -w '%{http_code}' http://127.0.0.1:8765/health || true)" = 200 ] || fail 'ADHD-A dashboard is not responding.'
[ "$(curl -sS --max-time 4 --noproxy '*' -o /dev/null -w '%{http_code}' "http://$GATEWAY:$PORT/bridge/v1/capabilities" || true)" = 401 ] || fail 'Authenticated-only v0.2 bridge is not listening on the private gateway.'

# All preflights have passed. Keep a timestamped copy of the current Compose source;
# this migration never uses docker compose down or --remove-orphans.
BACKUP_DIR="$BASE/unified-stack-backup-$(date -u +%Y%m%dT%H%M%SZ)"
mkdir -p "$BACKUP_DIR"
chmod 700 "$BACKUP_DIR"
cp -p -- "$COMPOSE_FILE" "$BACKUP_DIR/docker-compose.yml.before-unify"
LEGACY_NAME="adhd-assistant-preunified-$(date -u +%Y%m%d%H%M%S)"
COMPOSE_WRITTEN=0
LEGACY_RENAMED=0
NEW_CREATED=0
ROLLED_BACK=0
BUDDY_CHANGED=0
COMMITTED=0

rollback(){
  [ "$COMMITTED" = 0 ] && [ "$ROLLED_BACK" = 0 ] || return 0
  ROLLED_BACK=1
  say 'Migration failed; restoring the original Compose definition and ADHD-A container.'
  if [ "$COMPOSE_WRITTEN" = 1 ]; then
    cp -p -- "$BACKUP_DIR/docker-compose.yml.before-unify" "$COMPOSE_FILE" || true
  fi
  if [ "$BUDDY_CHANGED" = 1 ]; then
    # Restore the exact image that was running before the beta pull/recreate.
    docker image tag "$ORIGINAL_PIXEL_IMAGE_ID" "$IMAGE" || true
    docker compose -p "$PROJECT" -f "$COMPOSE_FILE" up -d --no-deps --pull never "$BUDDY_SERVICE" || true
  fi
  if [ "$NEW_CREATED" = 1 ]; then
    if [ "$(docker inspect -f '{{index .Config.Labels "com.docker.compose.service"}}' "$CONTAINER" 2>/dev/null || true)" = "$CONTAINER" ]; then
      docker stop "$CONTAINER" >/dev/null 2>&1 || true
      docker rm "$CONTAINER" >/dev/null 2>&1 || true
    fi
  fi
  if [ "$LEGACY_RENAMED" = 1 ]; then
    docker rename "$LEGACY_NAME" "$CONTAINER" || true
    docker start "$CONTAINER" >/dev/null 2>&1 || true
  fi
  say "Rollback finished. The original source Compose backup remains at $BACKUP_DIR"
}
trap 'rollback' ERR
trap 'rollback; exit 130' INT TERM

# Insert a service adjacent to the original Pixel Pals service in the same Compose file,
# and inject a read-only token mount plus its path into the running Pixel Pals service.
STAGED="$(mktemp "$COMPOSE_DIR/.unified-adhd-XXXXXX.yml")"
awk -v buddy="$BUDDY_SERVICE" -v data="$DATA" -v app="$APP" '
BEGIN { service=0; env=0; vol=0; services=0 }
/^services:[[:space:]]*$/ {
 print
 print "  adhd-assistant:"
 print "    image: python:3.12-alpine"
 print "    container_name: adhd-assistant"
 print "    restart: unless-stopped"
 print "    network_mode: host"
 print "    read_only: true"
 print "    tmpfs:"
 print "      - /tmp:rw,nosuid,nodev,size=32m"
 print "    cap_drop: [ALL]"
 print "    security_opt: [no-new-privileges:true]"
 print "    pids_limit: 128"
 print "    mem_limit: 320m"
 print "    cpus: 1.5"
 print "    user: \"99:100\""
 print "    working_dir: /opt/adhd"
 print "    environment:"
 print "      PYTHONDONTWRITEBYTECODE: \"1\""
 print "      HOME: /data"
 print "    volumes:"
 print "      - "app":/opt/adhd:ro"
 print "      - "data":/data:rw"
 print "    command: [python, -B, launch.py, --host, 127.0.0.1, --port, \"8765\", --data-dir, /data, --no-browser]"
 print "    healthcheck:"
 print "      test: [CMD, python, -B, -c, \"import urllib.request; urllib.request.urlopen(\047http://127.0.0.1:8765/health\047, timeout=3).read()\"]"
 print "      interval: 30s"
 print "      timeout: 6s"
 print "      retries: 3"
 print "      start_period: 20s"
 services++;next
}
/^  [a-zA-Z0-9_-]+:[[:space:]]*(#.*)?$/ {service=($0 ~ ("^  "buddy":"))}
service && /^    environment:[[:space:]]*(#.*)?$/ {
 print
 print "      ADHD_BRIDGE_ENABLED: \"1\""
 print "      ADHD_BRIDGE_PEER_URL: http://host.docker.internal:18766"
 print "      ADHD_BRIDGE_ALLOW_DOCKER_HOST: \"1\""
 print "      ADHD_BRIDGE_PEER_TOKEN_FILE: /run/secrets/adhd_bridge_token"
 env++;next
}
service && /^    volumes:[[:space:]]*(#.*)?$/ {
 print
 print "      - "data"/bridge-v02-token:/run/secrets/adhd_bridge_token:ro"
 vol++;next
}
{print}
END {if (services != 1 || env != 1 || vol != 1) exit 44}
' "$COMPOSE_FILE" > "$STAGED" || { rm -f -- "$STAGED"; fail 'Could not safely insert the ADHD-A service and bridge mounts.'; }

docker compose -p "$PROJECT" -f "$STAGED" config --quiet || { rm -f -- "$STAGED"; fail 'Unified Compose file failed validation. No container was changed.'; }
# Make sure Compose sees exactly the two intended services after validation.
docker compose -p "$PROJECT" -f "$STAGED" config --services | grep -qx "$CONTAINER" || { rm -f "$STAGED"; fail 'ADHD service missing from staged Compose.'; }
docker compose -p "$PROJECT" -f "$STAGED" config --services | grep -qx "$BUDDY_SERVICE" || { rm -f "$STAGED"; fail 'Pixel Pals service missing from staged Compose.'; }

# Preserve the original container as a stopped rollback checkpoint.
say 'Moving existing ADHD-A under a rollback name and adopting it into Compose.'
docker stop "$CONTAINER" >/dev/null
# If rename fails, the old container is still present and just needs starting.
docker rename "$CONTAINER" "$LEGACY_NAME" || { docker start "$CONTAINER" >/dev/null || true; fail 'Could not reserve the old container for rollback.'; }
LEGACY_RENAMED=1
chmod --reference="$COMPOSE_FILE" "$STAGED"
chown --reference="$COMPOSE_FILE" "$STAGED"
mv -- "$STAGED" "$COMPOSE_FILE"; COMPOSE_WRITTEN=1

NEW_CREATED=1
docker compose -p "$PROJECT" -f "$COMPOSE_FILE" up -d --no-deps --pull never "$CONTAINER"
for i in $(seq 1 25); do
  status="$(curl -sS --max-time 2 --noproxy '*' -o /dev/null -w '%{http_code}' http://127.0.0.1:8765/health 2>/dev/null || true)"
  [ "$status" = 200 ] && break
  sleep 1
done
[ "$status" = 200 ] || { rollback; fail 'Compose-managed ADHD-A failed health check.'; }

# Only Pixel Pals is recreated for its new read-only secret mount and environment.
say 'Enabling the private bridge in Pixel Pals (no image change outside beta).'
BUDDY_CHANGED=1
docker compose -p "$PROJECT" -f "$COMPOSE_FILE" up -d --no-deps --pull never "$BUDDY_SERVICE"
for i in $(seq 1 30); do
  health="$(docker inspect -f '{{.State.Health.Status}}' "$PIXEL_CONTAINER" 2>/dev/null || true)"
  [ "$health" = healthy ] && break
  sleep 2
done
[ "$health" = healthy ] || { rollback; fail 'Pixel Pals did not recover healthy after bridge activation.'; }
docker exec "$PIXEL_CONTAINER" sh -c 'test -r /run/secrets/adhd_bridge_token' || { rollback; fail 'Pixel Pals cannot read the private bridge secret mount.'; }
# Bridge must be reachable from Pixel Pals; never print or transmit the bearer token in logs.
docker exec "$PIXEL_CONTAINER" bun -e 'fetch("http://host.docker.internal:18766/bridge/v1/capabilities").then(r=>process.exit(r.status===401?0:1)).catch(()=>process.exit(1))' || { rollback; fail 'Bridge is not reachable through the private Docker gateway.'; }

COMMITTED=1
trap - ERR INT TERM
say 'SUCCESS: Pixel Pals and ADHD-A v0.2 are now managed by the same Compose stack.'
say "Stack project: $PROJECT; Compose file: $COMPOSE_FILE"
say 'Caddy LAN proxy was not touched. Neither database was reset.'
say "ADHD-A old stopped container: $LEGACY_NAME (rollback checkpoint; do not remove until satisfied)."
say 'No approved task or private memory was automatically transferred.'
say 'Review ADHD-A inbox: docker exec adhd-assistant python -m adhd_assistant.bridge_v02 list'
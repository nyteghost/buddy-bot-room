#!/usr/bin/env bash
# Pixel Pals + ADHD-A v0.2 Unraid unified Compose migration.
# Operates only on a verified existing Pixel Pals Compose project and ADHD v0.1/v0.2 install.
# Does not run docker compose down, remove volumes, replace Caddy, or touch GitHub main.
set -Eeuo pipefail

REPO='nyteghost/buddy-bot-room'
BRIDGE_COMMIT='7feb35b13acfda6eb4e3eccad078ba3922181701'
BRIDGE_URL="https://raw.githubusercontent.com/$REPO/$BRIDGE_COMMIT/tools/adhd-v02/bridge_v02.py"
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
for bin in docker awk grep curl mktemp sed cp install cmp base64 head chown chmod; do command -v "$bin" >/dev/null 2>&1 || fail "Missing $bin"; done
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
# Compose Manager may launch Pixel Pals with multiple ordered Compose files.
# Keep that complete list; NEVER flatten or silently discard overrides.
[[ "$PROJECT" == pixelpals ]] || fail 'Only the verified pixelpals Compose project is supported; no changes made.'
if [[ -z "$FILES" || "$FILES" == '<no value>' || "$FILES" == *$'\n'* ]]; then
  fail 'The running Pixel Pals container has no usable Compose-file label. No changes made; collect the sanitized layout report.'
fi
IFS=',' read -r -a COMPOSE_FILES <<< "$FILES"
(( ${#COMPOSE_FILES[@]} >= 1 && ${#COMPOSE_FILES[@]} <= 8 )) || fail 'Unexpected number of Compose source files; no changes made.'
if (( ${#COMPOSE_FILES[@]} == 1 )) && [ ! -f "${COMPOSE_FILES[0]}" ]; then
  FALLBACK="/boot/config/plugins/compose.manager/projects/$PROJECT/docker-compose.yml"
  [ -f "$FALLBACK" ] || fail 'Active Compose source does not exist and no known Compose Manager fallback is present.'
  COMPOSE_FILES=("$FALLBACK")
fi
COMPOSE_FLAGS=()
COMPOSE_DIR="/boot/config/plugins/compose.manager/projects/$PROJECT"
for config_path in "${COMPOSE_FILES[@]}"; do
  [[ "$config_path" == "$COMPOSE_DIR/"* ]] ||
    fail 'At least one Compose file is outside the known Unraid Compose Manager project. No changes made.'
  [[ "$config_path" == *.yml || "$config_path" == *.yaml ]] ||
    fail 'Unexpected Compose file extension; no changes made.'
  [[ -f "$config_path" && ! -L "$config_path" ]] ||
    fail 'A Compose source file is missing or a symbolic link; no changes made.'
  COMPOSE_FLAGS+=(-f "$config_path")
done

# Select only the single source file that actually owns the running buddy service's
# mapping-style environment and list-style volumes; other overlay files are left intact.
COMPOSE_FILE=""
OWNERS=0
for config_path in "${COMPOSE_FILES[@]}"; do
  if awk -v target="$BUDDY_SERVICE" '
  /^  [a-zA-Z0-9_-]+:[[:space:]]*(#.*)?$/ {
    name=$0; sub(/^  /,"",name); sub(/:.*/,"",name);
    inside=(name==target); if(inside) found++;
  }
  inside && /^    environment:[[:space:]]*(#.*)?$/ { env++ }
  inside && /^    volumes:[[:space:]]*(#.*)?$/ { vols++ }
  END { exit !(found==1 && env==1 && vols==1) }
  ' "$config_path"; then
    COMPOSE_FILE="$config_path"
    OWNERS=$((OWNERS+1))
  fi
done
(( OWNERS == 1 )) ||
  fail 'Cannot identify one safe Pixel Pals service definition containing environment and volumes. No changes made.'
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

docker compose -p "$PROJECT" "${COMPOSE_FLAGS[@]}" config --quiet || fail 'Existing full Compose configuration failed validation.'
docker compose -p "$PROJECT" "${COMPOSE_FLAGS[@]}" config --images | grep -Fxq "$IMAGE" || fail 'The active Compose configuration does not reference the expected Pixel Pals beta image.'
if docker compose -p "$PROJECT" "${COMPOSE_FLAGS[@]}" config --services | grep -qx "$CONTAINER"; then
  say 'ADHD-A already appears in this Compose project. No changes made.'
  docker compose -p "$PROJECT" "${COMPOSE_FLAGS[@]}" ps "$CONTAINER" || true
  exit 0
fi
[[ "$(grep -Ec '^services:[[:space:]]*$' "$COMPOSE_FILE")" == 1 ]] || fail 'Expected one top-level services: block.'
[[ "$(grep -Ec "^  ${BUDDY_SERVICE}:[[:space:]]*(#.*)?$" "$COMPOSE_FILE")" == 1 ]] || fail 'Cannot uniquely locate the active Pixel Pals service in YAML.'
for config_path in "${COMPOSE_FILES[@]}"; do
  if grep -Eq 'ADHD_BRIDGE_(ENABLED|PEER_TOKEN|PEER_URL|ALLOW_DOCKER_HOST)' "$config_path"; then
    fail 'Existing bridge settings found in a Compose source. Merge requires manual review; nothing changed.'
  fi
done
grep -Eq '^version[[:space:]]*=[[:space:]]*"0\.1\.0"' "$APP/pyproject.toml" ||
  fail 'This separate bridge migration expects the installed ADHD dashboard v0.1; no files were changed.'
[ ! -L "$BASE/bridge/bridge_v02.py" ] ||
  fail 'Bridge source must not be a symbolic link.'
docker inspect adhd-assistant-bridge >/dev/null 2>&1 &&
  fail 'A bridge container already exists; no changes made.'
if command -v ss >/dev/null 2>&1 && ss -H -lnt | awk '{print $4}' | grep -Eq ":${PORT}$"; then
  fail 'Bridge port 18766 is already listening; no changes made.'
fi

say "Compose project: $PROJECT; Pixel Pals service: $BUDDY_SERVICE"
say "Compose files: ${#COMPOSE_FILES[@]} (original order preserved)"
for config_path in "${COMPOSE_FILES[@]}"; do say "  source: $config_path"; done
say "Patch target: $COMPOSE_FILE"
say "Docker network: $NETWORK ($CIDR; gateway $GATEWAY)"
say "ADHD-A source: $APP; data: $DATA"
say 'The existing Caddy container will stay outside this stack and remain untouched.'
# Compose may leave a second created-but-never-started buddy service after a
# failed recreation. Report it rather than deleting or renaming any container.
SHADOWS="$(docker ps -a --filter "label=com.docker.compose.project=$PROJECT" --filter "label=com.docker.compose.service=$BUDDY_SERVICE" --format '{{.Names}}|{{.State}}' | grep -v "^$PIXEL_CONTAINER|" || true)"
if [ -n "$SHADOWS" ]; then
  say 'NOTE: Extra Compose-managed Pixel Pals containers were detected; no container will be deleted:'
  while IFS= read -r shadow; do say "  extra: $shadow"; done <<< "$SHADOWS"
  if [ "$MODE" = '--install' ]; then
    fail 'Duplicate Pixel Pals service containers exist. Resolve the created-only shadow container explicitly before recreating Pixel Pals; no data or containers changed.'
  fi
fi
if [ "$MODE" = '--plan' ]; then
  say 'PLAN ONLY: add isolated v0.2 bridge sidecar, adopt existing ADHD-A dashboard without patching launch.py, and configure authenticated Pixel Pals connection. No changes made.'
  exit 0
fi

# Preflight a beta image with support for read-only token-file credentials, before touching running containers.
say 'Downloading current beta image and checking token-file bridge support.'
docker pull "$IMAGE" >/dev/null || fail 'Cannot pull the Pixel Pals beta image.'
docker run --rm --network none --entrypoint sh "$IMAGE" -c 'grep -q ADHD_BRIDGE_PEER_TOKEN_FILE /app/src/lib/adhd-bridge.server.ts' || fail 'The published beta image lacks the new token-file bridge support. Nothing has been migrated.'

# Verify standalone bridge code before any running container is modified.
say 'Downloading and syntax-checking isolated bridge service (no launch.py patch).'
BRIDGE_STAGE="$(mktemp "$BASE/.bridge-v02-stage.XXXXXXXX")"
curl -fsSL --retry 2 --proto '=https' --tlsv1.2 "$BRIDGE_URL" -o "$BRIDGE_STAGE" ||
  { rm -f -- "$BRIDGE_STAGE"; fail 'Cannot download pinned standalone bridge code.'; }
grep -q 'arguments.action == "serve"' "$BRIDGE_STAGE" ||
  { rm -f -- "$BRIDGE_STAGE"; fail 'Downloaded bridge does not support standalone server mode.'; }
docker run --rm --network none --entrypoint python -v "$BRIDGE_STAGE:/bridge.py:ro" python:3.12-alpine \
  -B -c 'from pathlib import Path; compile(Path("/bridge.py").read_text(), "/bridge.py", "exec")' ||
  { rm -f -- "$BRIDGE_STAGE"; fail 'Standalone bridge Python failed syntax verification.'; }
[ ! -L "$DATA/bridge-v02-token" ] && [ ! -L "$DATA/bridge-v02.json" ] ||
  { rm -f -- "$BRIDGE_STAGE"; fail 'Bridge secret/configuration cannot be symlinks.'; }
EXPECTED_BRIDGE_CONFIG="$(printf '{"bind":"%s","port":%s,"allow":["%s"]}' "$GATEWAY" "$PORT" "$CIDR")"
if [ -f "$DATA/bridge-v02.json" ] &&
   [ "$(cat "$DATA/bridge-v02.json")" != "$EXPECTED_BRIDGE_CONFIG" ]; then
  rm -f -- "$BRIDGE_STAGE"
  fail 'Existing bridge configuration differs from the intended private gateway. No changes made.'
fi
if [ -e "$BASE/bridge/bridge_v02.py" ] &&
   ! cmp -s "$BRIDGE_STAGE" "$BASE/bridge/bridge_v02.py"; then
  rm -f -- "$BRIDGE_STAGE"
  fail 'Existing standalone bridge code differs from this pinned release. No changes made.'
fi

# All preflights have passed. Keep a timestamped copy of the current Compose source;
# this migration never uses docker compose down or --remove-orphans.
BACKUP_DIR="$BASE/unified-stack-backup-$(date -u +%Y%m%dT%H%M%SZ)"
mkdir -p "$BACKUP_DIR"
chmod 700 "$BACKUP_DIR"
cp -p -- "$COMPOSE_FILE" "$BACKUP_DIR/docker-compose.yml.before-unify"
# The regular ADHD web dashboard is left unpatched. The bridge is its own Compose service.
BRIDGE_DIR="$BASE/bridge"
mkdir -p "$BRIDGE_DIR"
[ ! -L "$BRIDGE_DIR" ] || fail 'Bridge directory is unexpectedly a symlink.'
if [ ! -f "$BRIDGE_DIR/bridge_v02.py" ]; then
  install -m 0644 "$BRIDGE_STAGE" "$BRIDGE_DIR/bridge_v02.py"
fi
rm -f -- "$BRIDGE_STAGE"
if [ ! -f "$DATA/bridge-v02-token" ]; then
  ( umask 077; head -c 48 /dev/urandom | base64 | tr -d '\n' > "$DATA/bridge-v02-token"; printf '\n' >> "$DATA/bridge-v02-token" )
fi
chown 99:100 "$DATA/bridge-v02-token" || true
chmod 600 "$DATA/bridge-v02-token"
if [ ! -f "$DATA/bridge-v02.json" ]; then
  printf '%s\n' "$EXPECTED_BRIDGE_CONFIG" > "$DATA/bridge-v02.json"
fi
chown 99:100 "$DATA/bridge-v02.json" || true
chmod 600 "$DATA/bridge-v02.json"
# Preflight against the *actual* private host gateway before stopping any app.
# Use the exact same account, security settings, mounts and Python runtime as the bridge sidecar.
say 'Preflighting bridge socket bind and file permissions as UID 99 (no app restarted).'
if ! docker run --rm --network host --user 99:100 --read-only \
  --cap-drop ALL --security-opt no-new-privileges --tmpfs /tmp:rw,nosuid,nodev,size=8m \
  -e ADHD_DATA_DIR=/data \
  -v "$BRIDGE_DIR/bridge_v02.py:/opt/bridge/bridge_v02.py:ro" -v "$DATA:/data:ro" \
  --entrypoint python python:3.12-alpine -B -c \
  'import json,runpy,pathlib; m=runpy.run_path("/opt/bridge/bridge_v02.py",run_name="preflight"); data=pathlib.Path("/data"); c=json.loads((data/"bridge-v02.json").read_text()); t=(data/"bridge-v02-token").read_text().strip(); s=m["make_server"](c,t); s.server_close(); print("PASS: bridge can bind private gateway with its real credentials")'; then
  fail 'Bridge runtime preflight failed before container migration; existing apps are still running.'
fi
# Verify the exact Docker-to-Docker path without touching the existing apps.
# The temporary server sees the same read-only code and secret, but cannot
# write to the ADHD database. Only an unauthenticated capabilities GET is made.
say 'Checking Pixel Pals -> bridge networking before restarting either application.'
PROBE_NAME="adhd-bridge-preflight-${BASHPID}"
docker run -d --rm --name "$PROBE_NAME" --network host --user 99:100 --read-only \
  --cap-drop ALL --security-opt no-new-privileges --tmpfs /tmp:rw,nosuid,nodev,size=8m \
  -e ADHD_DATA_DIR=/data \
  -v "$BRIDGE_DIR/bridge_v02.py:/opt/bridge/bridge_v02.py:ro" -v "$DATA:/data:ro" \
  --entrypoint python python:3.12-alpine \
  -B /opt/bridge/bridge_v02.py serve >/dev/null ||
    fail 'Could not start temporary bridge preflight container. Existing apps untouched.'
PROBE_REACHABLE=0
for i in $(seq 1 12); do
  if docker exec "$PIXEL_CONTAINER" bun -e \
    'fetch("http://host.docker.internal:18766/bridge/v1/capabilities").then(r=>process.exit(r.status===401?0:1)).catch(()=>process.exit(1))' >/dev/null 2>&1; then
    PROBE_REACHABLE=1
    break
  fi
  sleep 1
done
if [ "$PROBE_REACHABLE" != 1 ]; then
  say 'Private network preflight failed; bridge diagnostics (no bearer tokens) follow.'
  docker logs --tail 25 "$PROBE_NAME" 2>&1 || true
  docker stop "$PROBE_NAME" >/dev/null 2>&1 || true
  fail 'Pixel Pals cannot reach authenticated bridge. No application container was restarted.'
fi
docker stop "$PROBE_NAME" >/dev/null ||
  fail 'Could not stop temporary bridge preflight; no application container was restarted.'
say 'PASS: Pixel Pals can reach the authenticated bridge on its private Docker gateway.'
LEGACY_NAME="adhd-assistant-preunified-$(date -u +%Y%m%d%H%M%S)"
COMPOSE_WRITTEN=0
LEGACY_RENAMED=0
NEW_CREATED=0
NEW_BRIDGE_CREATED=0
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
    docker compose -p "$PROJECT" "${COMPOSE_FLAGS[@]}" up -d --no-deps --pull never "$BUDDY_SERVICE" || true
  fi
  if [ "$NEW_BRIDGE_CREATED" = 1 ]; then
    if [ "$(docker inspect -f '{{index .Config.Labels "com.docker.compose.service"}}' adhd-assistant-bridge 2>/dev/null || true)" = adhd-bridge ]; then
      docker stop adhd-assistant-bridge >/dev/null 2>&1 || true
      docker rm adhd-assistant-bridge >/dev/null 2>&1 || true
    fi
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
  # A failed Compose recreation can leave the original Pixel Pals container stopped
  # even after its YAML and image have been restored. Explicitly start by its
  # original name instead of relying on Compose to finish recreating it.
  if docker inspect "$PIXEL_CONTAINER" >/dev/null 2>&1; then
    if [ "$(docker inspect -f '{{.State.Running}}' "$PIXEL_CONTAINER" 2>/dev/null || true)" != true ]; then
      say 'Pixel Pals was stopped during rollback; attempting to restart the existing container.'
      docker start "$PIXEL_CONTAINER" >/dev/null 2>&1 || true
    fi
    RESTORED_RUNNING="$(docker inspect -f '{{.State.Running}}' "$PIXEL_CONTAINER" 2>/dev/null || true)"
    if [ "$RESTORED_RUNNING" != true ]; then
      say 'WARNING: Pixel Pals is still stopped. Review Docker logs before trying another installation.'
      docker inspect -f 'Pixel Pals: status={{.State.Status}} exit={{.State.ExitCode}} OOM={{.State.OOMKilled}}' "$PIXEL_CONTAINER" 2>/dev/null || true
    fi
  else
    say 'WARNING: The original Pixel Pals container name is unavailable after rollback.'
  fi
  say "Rollback finished. The original source Compose backup remains at $BACKUP_DIR"
}
trap 'rollback' ERR
trap 'rollback; exit 130' INT TERM

# Insert a service adjacent to the original Pixel Pals service in the same Compose file,
# and inject a read-only token mount plus its path into the running Pixel Pals service.
STAGED="$(mktemp "$COMPOSE_DIR/.unified-adhd-XXXXXX.yml")"
awk -v buddy="$BUDDY_SERVICE" -v data="$DATA" -v app="$APP" -v bridge_dir="$BRIDGE_DIR" -v gateway="$GATEWAY" '
BEGIN { service=0; env=0; vol=0; services=0 }
/^services:[[:space:]]*$/ {
 print
 print "  adhd-bridge:"
 print "    image: python:3.12-alpine"
 print "    container_name: adhd-assistant-bridge"
 print "    restart: unless-stopped"
 print "    network_mode: host"
 print "    read_only: true"
 print "    tmpfs:"
 print "      - /tmp:rw,nosuid,nodev,size=32m"
 print "    cap_drop: [ALL]"
 print "    security_opt: [no-new-privileges:true]"
 print "    pids_limit: 128"
 print "    mem_limit: 128m"
 print "    cpus: 0.5"
 print "    user: \"99:100\""
 print "    environment:"
 print "      PYTHONDONTWRITEBYTECODE: \"1\""
 print "      ADHD_DATA_DIR: /data"
 print "    volumes:"
 print "      - "bridge_dir"/bridge_v02.py:/opt/bridge/bridge_v02.py:ro"
 print "      - "data":/data:rw"
 print "    command: [python, -B, /opt/bridge/bridge_v02.py, serve]"
 print "    healthcheck:"
 print "      test: [CMD, python, -B, -c, \"import socket; s=socket.create_connection((\047"gateway"\047,18766),timeout=3); s.close()\"]"
 print "      interval: 30s"
 print "      timeout: 6s"
 print "      retries: 3"
 print "      start_period: 15s"
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

# Validate the staged file in the original full multi-file order; never drop overlays.
STAGED_FLAGS=()
for config_path in "${COMPOSE_FILES[@]}"; do
  if [ "$config_path" = "$COMPOSE_FILE" ]; then
    STAGED_FLAGS+=(-f "$STAGED")
  else
    STAGED_FLAGS+=(-f "$config_path")
  fi
done
docker compose -p "$PROJECT" "${STAGED_FLAGS[@]}" config --quiet || { rm -f -- "$STAGED"; fail 'Unified full Compose configuration failed validation. No container was changed.'; }
docker compose -p "$PROJECT" "${STAGED_FLAGS[@]}" config --services | grep -qx "$CONTAINER" || { rm -f "$STAGED"; fail 'ADHD service missing from staged Compose.'; }
docker compose -p "$PROJECT" "${STAGED_FLAGS[@]}" config --services | grep -qx adhd-bridge || { rm -f "$STAGED"; fail 'Private bridge sidecar missing from staged Compose.'; }
docker compose -p "$PROJECT" "${STAGED_FLAGS[@]}" config --services | grep -qx "$BUDDY_SERVICE" || { rm -f "$STAGED"; fail 'Pixel Pals service missing from staged Compose.'; }

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
NEW_BRIDGE_CREATED=1
docker compose -p "$PROJECT" "${COMPOSE_FLAGS[@]}" up -d --no-deps --pull never "$CONTAINER" adhd-bridge
for i in $(seq 1 25); do
  status="$(curl -sS --max-time 2 --noproxy '*' -o /dev/null -w '%{http_code}' http://127.0.0.1:8765/health 2>/dev/null || true)"
  [ "$status" = 200 ] && break
  sleep 1
done
[ "$status" = 200 ] || { rollback; fail 'Compose-managed ADHD-A failed health check.'; }
# Probe from the REAL Pixel Pals Docker network. Probing from the Unraid host
# can legitimately return HTTP 403 because the bridge denies non-allowlisted clients.
say 'Checking authenticated-only bridge from the Pixel Pals Docker network.'
BRIDGE_REACHABLE=0
for i in $(seq 1 30); do
  if docker exec "$PIXEL_CONTAINER" bun -e \
    'fetch("http://host.docker.internal:18766/bridge/v1/capabilities").then(r=>process.exit(r.status===401?0:1)).catch(()=>process.exit(1))' >/dev/null 2>&1; then
    BRIDGE_REACHABLE=1
    break
  fi
  sleep 2
done
if [ "$BRIDGE_REACHABLE" != 1 ]; then
  say 'Bridge did not return HTTP 401 to Pixel Pals. Capturing safe diagnostics before rollback.'
  docker inspect --format 'bridge state={{.State.Status}} exit={{.State.ExitCode}}' adhd-assistant-bridge 2>/dev/null || true
  docker logs --tail 35 adhd-assistant-bridge 2>&1 | sed -E 's/(Bearer[[:space:]]+|token=)[A-Za-z0-9_+\/=.-]+/\\1[redacted]/g' || true
  HOST_CODE="$(curl -sS --noproxy '*' --max-time 3 -o /dev/null -w '%{http_code}' "http://$GATEWAY:$PORT/bridge/v1/capabilities" 2>/dev/null || true)"
  say "Unauthenticated host probe returned HTTP ${HOST_CODE:-000}. Host-only HTTP 403 may be normal."
  rollback
  fail 'Standalone bridge connectivity failed; original containers restored.'
fi

# Only Pixel Pals is recreated for its new read-only secret mount and environment.
say 'Enabling the private bridge in Pixel Pals (beta only).'
BUDDY_CHANGED=1
docker compose -p "$PROJECT" "${COMPOSE_FLAGS[@]}" up -d --no-deps --pull never "$BUDDY_SERVICE"
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
say 'SUCCESS: Pixel Pals, existing ADHD dashboard, and v0.2 bridge are managed by one Compose stack.'
say "Stack project: $PROJECT; Compose file: $COMPOSE_FILE"
say 'Caddy LAN proxy was not touched. Neither database was reset.'
say "ADHD-A old stopped container: $LEGACY_NAME (rollback checkpoint; do not remove until satisfied)."
say 'No approved task or private memory was automatically transferred.'
say 'Review ADHD-A inbox: docker exec adhd-assistant-bridge python -B /opt/bridge/bridge_v02.py list'
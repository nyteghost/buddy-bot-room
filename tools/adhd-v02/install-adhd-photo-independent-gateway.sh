#!/usr/bin/env bash
# Additional private HTTPS gateway for EXISTING pixelpals photo beta stack.
# No production Caddyfile edit/reload, no full-stack compose up/down.
set -Eeuo pipefail
set +x
umask 077

PROJECT=/boot/config/plugins/compose.manager/projects/pixelpals
BASE=/mnt/user/appdata/adhd-assistant-photo-beta/gateway
CFILE="$BASE/conf/Caddyfile"
PHOTO_OVERLAY="$PROJECT/docker-compose.photo-beta.yml"
GATEWAY_OVERLAY="$PROJECT/docker-compose.photo-gateway.yml"
BETA_PORT=18767
HTTPS_PORT=18768
LAN_IP=10.200.1.30
ORIGINAL_PROXY=adhd-assistant-lan
IMAGE=''
TEMP=''
PASS=''
PASS2=''
HASH=''
fail(){ printf 'BLOCKED: %s\n' "$*" >&2; exit 1; }
phase(){ printf '\n== %s ==\n' "$*"; }
cleanup(){ unset PASS PASS2 HASH || :; if [[ -n "$TEMP" ]]; then rm -rf -- "$TEMP"; fi; }
trap cleanup EXIT

[[ "$EUID" -eq 0 ]] || fail 'Use the Unraid root terminal.'
for tool in docker curl ip ss grep mktemp install awk cp chmod chown; do
  command -v "$tool" >/dev/null 2>&1 || fail "Missing $tool"
done
for path in "$PROJECT/docker-compose.yml" "$PROJECT/docker-compose.override.yml" "$PHOTO_OVERLAY"; do
  [[ -f "$path" && ! -L "$path" ]] || fail "Missing or linked active Compose file: $path"
done
for path in "$BASE" "$BASE/conf" "$BASE/data" "$BASE/config" "$CFILE" "$GATEWAY_OVERLAY"; do
  [[ ! -L "$path" ]] || fail "Unexpected gateway symlink: $path"
done
[[ ! -e "$CFILE" && ! -e "$GATEWAY_OVERLAY" ]] ||
  fail 'Beta gateway already configured; do not overwrite or recreate.'
if docker container inspect adhd-assistant-photo-gateway >/dev/null 2>&1; then
  fail 'Beta gateway container already exists.'
fi

phase 'Protect production and verify healthy photo beta'
for name in buddy-bot-room adhd-assistant adhd-assistant-bridge adhd-assistant-photo-beta "$ORIGINAL_PROXY"; do
  [[ "$(docker inspect -f '{{.State.Running}}' "$name" 2>/dev/null)" == true ]] ||
    fail "Container not running: $name"
done
[[ "$(docker inspect -f '{{index .Config.Labels "com.docker.compose.project"}}' buddy-bot-room)" == pixelpals ]] ||
  fail 'Pixel Pals Compose project differs from expected.'
curl --fail --silent --show-error --max-time 5 "http://127.0.0.1:$BETA_PORT/health" >/dev/null ||
  fail 'Existing photo beta backend health unavailable.'
[[ "$(docker inspect -f '{{.HostConfig.NetworkMode}}' "$ORIGINAL_PROXY")" == host ]] ||
  fail 'Production Caddy is not host network: review required.'
IMAGE="$(docker inspect -f '{{.Config.Image}}' "$ORIGINAL_PROXY")"
[[ "$IMAGE" =~ ^[a-zA-Z0-9./:@_-]+$ ]] ||
  fail 'Existing Caddy image reference is unfamiliar.'
docker image inspect "$IMAGE" >/dev/null 2>&1 ||
  fail 'Existing Caddy image is not locally available.'
docker exec "$ORIGINAL_PROXY" caddy version >/dev/null 2>&1 ||
  fail 'Existing proxy is not a known Caddy image.'

if ! ip -4 -o addr show | grep -Eq '10\.200\.1\.30/'; then
  fail 'Unraid LAN IP does not match verified server.'
fi
LISTEN="$(ss -ltnH)" || fail 'Could not inspect TCP listeners.'
if printf '%s\n' "$LISTEN" | awk -v target=":$HTTPS_PORT" \
    '$4 ~ target"$" {found=1} END{exit !found}'; then
  fail 'Port 18768 is already in use; no service will be stopped.'
fi
printf '%s\n' "$LISTEN" | awk '$4 ~ /:18765$/ {found=1} END{exit !found}' ||
  fail 'Existing production Caddy listener 18765 is unavailable.'
[[ -d "$PROJECT" ]] || fail 'Pixel Pals Compose directory not found.'
for path in "$BASE/conf" "$BASE/data" "$BASE/config"; do
  if [[ -d "$path" && -n "$(find "$path" -mindepth 1 -print -quit)" ]]; then
    fail "Gateway staging path not empty: $path"
  fi
done

phase 'Obtain unique HTTPS beta credentials'
echo 'Only the new 18768 beta gateway will be created.'
echo 'Production Caddy on 18765 will not be reloaded, stopped or edited.'
echo 'The beta uses a DIFFERENT Caddy internal CA. Trust it on both devices later.'
read -r -p 'Beta username [adhd-beta]: ' USERNAME
[[ -n "$USERNAME" ]] || USERNAME='adhd-beta'
[[ "$USERNAME" =~ ^[A-Za-z][A-Za-z0-9_.-]{1,31}$ ]] ||
  fail 'Username must start with a letter and be 2-32 ASCII characters.'
read -r -s -p 'New beta password (14+ chars; hidden): ' PASS
printf '\n'
read -r -s -p 'Repeat beta password (hidden): ' PASS2
printf '\n'
[[ "$PASS" == "$PASS2" && "$(printf %s "$PASS" | wc -c)" -ge 14 ]] ||
  fail 'Passwords do not match or are too short.'
unset PASS2
HASH="$(printf '%s\n' "$PASS" | docker exec -i "$ORIGINAL_PROXY" \
  caddy hash-password --algorithm bcrypt 2>/dev/null)" ||
  fail 'Caddy password hashing failed.'
unset PASS
[[ "$HASH" =~ ^\$2[aby]\$[0-9][0-9]\$[A-Za-z0-9./]{53}$ ]] ||
  fail 'Caddy returned an unexpected bcrypt hash.'

TEMP="$(mktemp -d /tmp/adhd-photo-gateway.XXXXXXXX)"
chmod 0700 "$TEMP"
# Separate new Caddy process: admin off prevents collision on host port 2019.
# No automatic redirects avoids collision with existing :80 and :443 services.
{
  cat <<'CADDY'
{
    admin off
    auto_https disable_redirects
}

https://10.200.1.30:18768 {
    bind 10.200.1.30
    tls internal

    @badOrigin {
        header Origin *
        not header Origin https://10.200.1.30:18768
    }
    @denyBridge path /bridge/v1/*

    route {
CADDY
  printf '        basic_auth {\n            %s %s\n        }\n' "$USERNAME" "$HASH"
  cat <<'CADDY'
        respond @badOrigin 403
        respond @denyBridge 404
        reverse_proxy http://127.0.0.1:18767 {
            header_up Host 127.0.0.1:18767
            header_up Origin http://127.0.0.1:18767
            header_up -Authorization
        }
    }
}
CADDY
} > "$TEMP/Caddyfile"
unset HASH
chmod 0600 "$TEMP/Caddyfile"
# Disposable validator runs as UID 99 and must be able to read the mounted file.
# Keep its contents private from other users on the Unraid host.
chown 99:100 "$TEMP/Caddyfile"

# A locally pinned, additive Compose service definition (does not include hashes).
SOURCE_SHA=050e28cc63562da87d0558c019434c04c3c8081d
curl -fsSL --proto '=https' --proto-redir '=https' --connect-timeout 10 \
  --max-time 40 -o "$TEMP/gateway.yml" \
  "https://raw.githubusercontent.com/nyteghost/buddy-bot-room/$SOURCE_SHA/tools/adhd-v02/photo-beta-independent-gateway.yml" ||
  fail 'Could not download optional gateway Compose service.'
grep -q '^  adhd-assistant-photo-gateway:' "$TEMP/gateway.yml" ||
  fail 'Unexpected gateway Compose definition.'

phase 'Validate standalone gateway without accessing production Caddy configuration'
# Isolated disposable Caddy validation: fresh tmpfs data/config and no network.
docker run --rm --pull never --network none --read-only \
  --user 99:100 --cap-drop ALL --security-opt no-new-privileges \
  --tmpfs /tmp:rw,nosuid,nodev,size=16m \
  --tmpfs /data:rw,nosuid,nodev,size=16m \
  --tmpfs /config:rw,nosuid,nodev,size=16m \
  --env XDG_DATA_HOME=/data --env XDG_CONFIG_HOME=/config \
  --mount "type=bind,src=$TEMP/Caddyfile,dst=/etc/caddy/Caddyfile,readonly" \
  --entrypoint caddy "$IMAGE" validate --config /etc/caddy/Caddyfile \
  --adapter caddyfile >/dev/null 2>&1 ||
  fail 'Isolated Caddy validation failed. No appdata or container changes.'

export ADHD_PHOTO_BETA_CODE_PATH=/mnt/user/appdata/adhd-assistant-photo-beta/code
export ADHD_PHOTO_BETA_DATA_PATH=/mnt/user/appdata/adhd-assistant-photo-beta/data
export ADHD_PHOTO_BETA_PORT=18767
export ADHD_PHOTO_BETA_OLLAMA_URL=http://10.200.1.149:11434
export ADHD_PHOTO_GATEWAY_IMAGE="$IMAGE"
export ADHD_PHOTO_GATEWAY_CONF="$BASE/conf"
export ADHD_PHOTO_GATEWAY_DATA="$BASE/data"
export ADHD_PHOTO_GATEWAY_XDG_CONFIG="$BASE/config"
(
  cd "$PROJECT"
  docker compose -p pixelpals \
    -f docker-compose.yml -f docker-compose.override.yml \
    -f "$PHOTO_OVERLAY" -f "$TEMP/gateway.yml" \
    --profile adhd-photo-beta config --quiet
) || fail 'Merged Compose configuration is invalid. No changes made.'

echo
echo 'New service ONLY: adhd-assistant-photo-gateway in existing pixelpals project'
echo "New private HTTPS URL: https://10.200.1.30:$HTTPS_PORT"
echo 'New separate gateway CA and files; production Caddy remains untouched.'
echo 'It will not expose the photo backend port 18767 publicly.'
read -r -p 'Type INSTALL INDEPENDENT BETA GATEWAY to approve: ' CONFIRM
[[ "$CONFIRM" == 'INSTALL INDEPENDENT BETA GATEWAY' ]] ||
  fail 'Cancelled. No appdata or production changes made.'

phase 'Create new gateway data and add only the extra Compose service'
install -d -o 99 -g 100 -m 0750 "$BASE" "$BASE/conf" "$BASE/data" "$BASE/config"
install -o 99 -g 100 -m 0640 "$TEMP/Caddyfile" "$CFILE"
install -m 0644 "$TEMP/gateway.yml" "$GATEWAY_OVERLAY"
(
  cd "$PROJECT"
  docker compose -p pixelpals -f docker-compose.yml \
    -f docker-compose.override.yml -f "$PHOTO_OVERLAY" -f "$GATEWAY_OVERLAY" \
    --profile adhd-photo-beta up -d --no-deps --pull never \
    adhd-assistant-photo-gateway
) || fail 'New gateway failed. Inspect ONLY this beta gateway; no existing containers were changed.'

# New container may need time to generate its own CA and bind TLS.
STATUS=''
for _ in 1 2 3 4 5 6 7 8 9 10; do
  STATUS="$(curl -ksS -o /dev/null -w '%{http_code}' --connect-timeout 2 \
    --max-time 3 "https://$LAN_IP:$HTTPS_PORT/api/bootstrap" 2>/dev/null || :)"
  [[ "$STATUS" == 401 ]] && break
  sleep 1
done
docker ps --filter 'name=^/adhd-assistant-photo-gateway$' \
  --format 'table {{.Names}}\t{{.Status}}\t{{.Image}}'
if [[ "$STATUS" == 401 ]]; then
  echo 'PASS: HTTPS beta gateway denies unauthenticated requests (HTTP 401).'
else
  echo "CHECK: HTTPS beta gateway returned $STATUS (expected 401)."
  echo 'Do not use the beta route until authentication is independently verified.'
  echo 'Read beta-only logs: docker logs --tail 80 adhd-assistant-photo-gateway'
  exit 1
fi
echo "Private LAN beta URL: https://$LAN_IP:$HTTPS_PORT"
echo "Username: $USERNAME (password is never logged)."
echo 'The NEW gateway CA public root is expected at:'
echo "$BASE/data/caddy/pki/authorities/local/root.crt"
echo 'Verify and explicitly trust the public CA on CachyOS/iPhone before browser use.'
echo 'Never share or install the private root.key on a client.'

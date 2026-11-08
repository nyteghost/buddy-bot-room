#!/usr/bin/env bash
# Read-only diagnostic for PRIVATE photo-beta gateway Caddy validator.
# Synthetic credentials; no live Caddy configuration, photo, SQLite or token.
set -Eeuo pipefail
set +x
umask 077

fail(){ printf 'BLOCKED: %s\n' "$*" >&2; exit 1; }
[[ "\${EUID:-1}" == 0 ]] || fail 'Run from the Unraid root terminal.'
for cmd in docker mktemp chown chmod grep; do
  command -v "$cmd" >/dev/null 2>&1 || fail "Missing $cmd"
done
[[ "$(docker inspect -f '{{.State.Running}}' adhd-assistant-lan 2>/dev/null)" == true ]] ||
  fail 'Production Caddy container is not running.'
[[ "$(docker inspect -f '{{.State.Running}}' adhd-assistant-photo-beta 2>/dev/null)" == true ]] ||
  fail 'Beta application container is not running.'
IMAGE="$(docker inspect -f '{{.Config.Image}}' adhd-assistant-lan)"
docker image inspect "$IMAGE" >/dev/null 2>&1 ||
  fail 'Installed Caddy image not found.'

TMP="$(mktemp -d /tmp/adhd-photo-caddy-check.XXXXXXXX)"
chmod 0700 "$TMP"
trap 'rm -rf -- "$TMP"' EXIT

# The bcrypt input is deliberately PUBLIC and not an actual application password.
SYNTHETIC_HASH="$(docker run --rm --pull never --network none \
  --entrypoint caddy "$IMAGE" hash-password --algorithm bcrypt \
  --plaintext 'only-a-synthetic-test-password' 2>/dev/null)" ||
  fail 'Could not generate a synthetic test hash.'
[[ "$SYNTHETIC_HASH" == '$2'* ]] || fail 'Synthetic bcrypt format unsupported.'

{
  cat <<'SITE'
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
SITE
  printf '        basic_auth {\n            syntheticuser %s\n        }\n' "$SYNTHETIC_HASH"
  cat <<'SITE'
        respond @badOrigin 403
        respond @denyBridge 404
        reverse_proxy http://127.0.0.1:18767 {
            header_up Host 127.0.0.1:18767
            header_up Origin http://127.0.0.1:18767
            header_up -Authorization
        }
    }
}
SITE
} > "$TMP/Caddyfile"
unset SYNTHETIC_HASH
chown 99:100 "$TMP/Caddyfile"
chmod 0600 "$TMP/Caddyfile"

echo '== ADHD beta Caddy validation diagnostic (synthetic-only) =='
echo 'No production Caddy config is opened; no container is kept running.'
echo 'No password, private key, credential or Caddy hash is printed.'

run_check(){
  local name="$1"; shift
  local report="$TMP/$name.log"
  if docker run --rm --pull never --network none --read-only \
      --user 99:100 --cap-drop ALL --security-opt no-new-privileges \
      "$@" \
      --mount "type=bind,src=$TMP/Caddyfile,dst=/etc/caddy/Caddyfile,readonly" \
      --entrypoint caddy "$IMAGE" validate --config /etc/caddy/Caddyfile \
      --adapter caddyfile >"$report" 2>&1; then
    printf '%s: PASS\n' "$name"
    return 0
  fi
  printf '%s: FAILED\n' "$name"
  # Whitelisted findings only; never print raw Caddy stderr.
  if grep -Eiq 'permission denied|operation not permitted' "$report"; then
    echo '  reason: permission denied'
  elif grep -Eiq 'read-only file system' "$report"; then
    echo '  reason: read-only filesystem'
  elif grep -Eiq 'no such file|not found' "$report"; then
    echo '  reason: missing path or resource'
  elif grep -Eiq 'network is unreachable|no route to host|connection refused' "$report"; then
    echo '  reason: network unavailable during provisioning'
  elif grep -Eiq 'unknown directive|syntax error|unrecognized|wrong argument count|parsing' "$report"; then
    echo '  reason: configuration parsing'
  elif grep -Eiq 'failed to install root|certificate|provision|storage|PKI|TLS' "$report"; then
    echo '  reason: certificate/module provisioning'
  else
    echo '  reason: unclassified (raw logs intentionally withheld)'
  fi
  return 1
}

common=(
  --tmpfs /tmp:rw,nosuid,nodev,size=16m
  --tmpfs /data:rw,nosuid,nodev,size=16m
  --tmpfs /config:rw,nosuid,nodev,size=16m
  --env XDG_DATA_HOME=/data
  --env XDG_CONFIG_HOME=/config
)
if run_check 'current_validator_settings' "\${common[@]}"; then
  echo 'Result: current validator succeeded with synthetic data; inspect other differences.'
else
  improved=(
    --tmpfs /tmp:rw,nosuid,nodev,size=16m,mode=1777
    --tmpfs /data:rw,nosuid,nodev,size=16m,uid=99,gid=100,mode=0700
    --tmpfs /config:rw,nosuid,nodev,size=16m,uid=99,gid=100,mode=0700
    --env XDG_DATA_HOME=/data
    --env XDG_CONFIG_HOME=/config
    --env HOME=/tmp
  )
  if run_check 'writable_private_storage' "\${improved[@]}"; then
    echo 'Result: missing writable Caddy temp/CA storage is the likely cause.'
  else
    echo 'Result: validation still fails. Do NOT run the gateway installer.'
    echo 'Share only this summary; further diagnostics will use synthetic files.'
  fi
fi
echo 'Existing applications, Compose project and Caddy configuration unchanged.'

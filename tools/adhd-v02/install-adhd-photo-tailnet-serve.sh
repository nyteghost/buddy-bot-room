#!/usr/bin/env bash
# Opt-in Tailscale Serve beta access. Preserves the existing Pixel Pals :8443 route
# and never modifies or restarts production Caddy / buddy-bot-room / native ADHD.
set -Eeuo pipefail
set +x
umask 077
PROXY=adhd-assistant-photo-gateway
CFILE=/mnt/user/appdata/adhd-assistant-photo-beta/gateway/conf/Caddyfile
CA=/mnt/user/appdata/adhd-assistant-photo-beta/gateway/data/caddy/pki/authorities/local/root.crt
TAIL_HOST=tower.tarpon-drum.ts.net
TAIL_HTTPS=8444
LOCAL_HTTP=18769
TMP=''
CANDIDATE=''
changed=0
fail(){ printf 'BLOCKED: %s\n' "$*" >&2; exit 1; }
notice(){ printf '\n== %s ==\n' "$*"; }
cleanup(){
  [[ -z "$TMP" ]] || rm -rf -- "$TMP"
  [[ -z "$CANDIDATE" ]] || rm -f -- "$CANDIDATE"
}
trap cleanup EXIT

[[ "$EUID" -eq 0 ]] || fail 'Run from Unraid root over secure SSH.'
for cmd in docker tailscale ss curl awk grep cp cmp stat chmod chown mktemp date; do
  command -v "$cmd" >/dev/null 2>&1 || fail "Missing $cmd"
done
[[ -f "$CFILE" && ! -L "$CFILE" && -f "$CA" ]] ||
  fail 'Independent beta gateway configuration / public root CA is missing.'
[[ "$(docker inspect -f '{{.State.Running}}' "$PROXY" 2>/dev/null)" == true ]] ||
  fail 'Beta-only gateway is not running.'
[[ "$(docker inspect -f '{{.State.Running}}' adhd-assistant-lan 2>/dev/null)" == true ]] ||
  fail 'Production Caddy is not running.'
[[ "$(docker inspect -f '{{.State.Running}}' adhd-assistant-photo-beta 2>/dev/null)" == true ]] ||
  fail 'Photo beta application is not running.'
grep -Fq 'https://10.200.1.30:18768' "$CFILE" ||
  fail 'Unexpected independent gateway site. Review before editing.'
[[ "$(grep -c 'basic_auth {' "$CFILE")" == 1 ]] ||
  fail 'Expected exactly one protected beta site.'
if grep -Fq 'ADHD TAILNET BETA 8444' "$CFILE"; then
  fail 'Tailscale gateway section already exists. Do not reinstall.'
fi

notice 'Verify existing Pixel Pals Tailscale Serve configuration'
BEFORE="$(tailscale serve status)" || fail 'Tailscale Serve status unavailable.'
[[ "$BEFORE" == *"$TAIL_HOST:8443"* && "$BEFORE" == *'http://127.0.0.1:8090'* ]] ||
  fail 'Existing Pixel Pals Tailscale Serve :8443 route differs from expected.'
[[ "$BEFORE" != *"$TAIL_HOST:$TAIL_HTTPS"* ]] ||
  fail 'Proposed Tailscale HTTPS :8444 route already exists.'
SOCKETS="$(ss -ltnH)" || fail 'TCP port inspection failed.'
if printf '%s\n' "$SOCKETS" | awk -v target=":$LOCAL_HTTP" \
    '$4 ~ target"$" {present=1} END{exit !present}'; then
  fail 'Local loopback beta HTTP port 18769 is already occupied.'
fi
if printf '%s\n' "$SOCKETS" | awk -v target=":$TAIL_HTTPS" \
    '$4 ~ target"$" {present=1} END{exit !present}'; then
  fail 'Proposed Tailscale HTTPS port 8444 already has a TCP listener.'
fi
if ! curl -sS --cacert "$CA" --connect-timeout 3 --max-time 6 \
  -o /dev/null -w '%{http_code}' https://10.200.1.30:18768/api/bootstrap |
     grep -qx '401'; then
  fail 'Existing LAN beta HTTPS gateway is not returning a verified unauthenticated 401.'
fi

# Read only the username+bcrypt *hash* from the existing beta-only file.
# The plaintext password is never requested, reentered, printed, or saved.
AUTH_LINE="$(awk '
  /^[[:space:]]*basic_auth[[:space:]]*\{/ { inside=1; next }
  inside && /^[[:space:]]*[A-Za-z][A-Za-z0-9_.-]*[[:space:]]+\$2[aby]\$/ {
    sub(/^[[:space:]]+/, "", $0); sub(/[[:space:]]+$/, "", $0);
    print $0; exit
  }' "$CFILE")"
[[ "$AUTH_LINE" =~ ^[A-Za-z][A-Za-z0-9_.-]*[[:space:]]+\$2[aby]\$ ]] ||
  fail 'Could not validate existing beta-only Basic Auth credential format.'
IMAGE="$(docker inspect -f '{{.Config.Image}}' "$PROXY")"
docker image inspect "$IMAGE" >/dev/null 2>&1 ||
  fail 'Local beta Caddy image is not available.'

TMP="$(mktemp -d /tmp/adhd-tailnet-gateway.XXXXXXXX)"
chmod 0700 "$TMP"
CANDIDATE="$TMP/Caddyfile"
cp -p -- "$CFILE" "$CANDIDATE"
{
  cat <<'TAIL'
# BEGIN ADHD TAILNET BETA 8444
# This listener is loopback only; Tailscale Serve provides external HTTPS.
:18769 {
    bind 127.0.0.1
    @badOrigin {
        header Origin *
        not header Origin https://tower.tarpon-drum.ts.net:8444
    }
    @denyBridge path /bridge/v1/*
    route {
        basic_auth {
TAIL
  printf '            %s\n' "$AUTH_LINE"
  cat <<'TAIL'
        }
        respond @badOrigin 403
        respond @denyBridge 404
        reverse_proxy http://127.0.0.1:18767 {
            header_up Host 127.0.0.1:18767
            header_up Origin http://127.0.0.1:18767
            header_up -Authorization
        }
    }
}
# END ADHD TAILNET BETA 8444
TAIL
} >> "$CANDIDATE"
unset AUTH_LINE
chown 99:100 "$CANDIDATE"
chmod 0600 "$CANDIDATE"

notice 'Validate new candidate in a disposable offline Caddy sandbox'
docker run --rm --pull never --network none --read-only \
  --user 99:100 --cap-drop ALL --security-opt no-new-privileges \
  --tmpfs /tmp:rw,nosuid,nodev,size=16m,mode=1777 \
  --tmpfs /data:rw,nosuid,nodev,size=16m,uid=99,gid=100,mode=0700 \
  --tmpfs /config:rw,nosuid,nodev,size=16m,uid=99,gid=100,mode=0700 \
  --env XDG_DATA_HOME=/data --env XDG_CONFIG_HOME=/config --env HOME=/tmp \
  --mount "type=bind,src=$CANDIDATE,dst=/etc/caddy/Caddyfile,readonly" \
  --entrypoint caddy "$IMAGE" validate --config /etc/caddy/Caddyfile \
  --adapter caddyfile >/dev/null 2>&1 ||
  fail 'Independent gateway candidate did not validate. No configuration changed.'

notice 'Confirm beta-only restart and additional tailnet mapping'
echo 'Existing Pixel Pals Serve :8443 -> http://127.0.0.1:8090 remains unchanged.'
echo 'Existing production Caddy :18765 is not touched.'
echo 'One beta-only Caddy gateway will be briefly restarted to add 127.0.0.1:18769.'
echo 'New tailnet HTTPS: https://tower.tarpon-drum.ts.net:8444'
echo 'Basic Auth reuses your existing private beta gateway login.'
echo 'No public Funnel, port forwarding or direct native beta exposure.'
read -r -p 'Type ADD ADHD TAILNET BETA to approve: ' CONSENT
[[ "$CONSENT" == 'ADD ADHD TAILNET BETA' ]] ||
  fail 'Cancelled. No configuration changes made.'

BACKUP="$(dirname "$CFILE")/Caddyfile.before-tailnet-beta-$(date -u +%Y%m%dT%H%M%SZ)"
cp -p -- "$CFILE" "$BACKUP"
chmod 0600 "$BACKUP"
chown --reference="$CFILE" "$CANDIDATE"
chmod --reference="$CFILE" "$CANDIDATE"
mv -- "$CANDIDATE" "$CFILE"
CANDIDATE=''
changed=1
if ! docker restart "$PROXY" >/dev/null 2>&1; then
  cp -p -- "$BACKUP" "$CFILE"
  docker restart "$PROXY" >/dev/null 2>&1 || :
  fail 'Beta-only gateway restart failed; restored prior configuration.'
fi
STATUS=''
for i in 1 2 3 4 5 6 7 8 9 10; do
  STATUS="$(curl -sS --connect-timeout 2 --max-time 3 -o /dev/null \
    -w '%{http_code}' http://127.0.0.1:18769/api/bootstrap 2>/dev/null || :)"
  [[ "$STATUS" == 401 ]] && break
  sleep 1
done
if [[ "$STATUS" != 401 ]]; then
  cp -p -- "$BACKUP" "$CFILE"
  docker restart "$PROXY" >/dev/null 2>&1 || :
  fail "Beta loopback route did not return 401 (status $STATUS); restored prior gateway."
fi
# Confirm the original LAN beta HTTPS endpoint remains functional after the
# scoped beta-gateway restart, still using the SAME private CA certificate.
LAN_STATUS="$(curl -sS --cacert "$CA" --connect-timeout 2 --max-time 6 \
  -o /dev/null -w '%{http_code}' https://10.200.1.30:18768/api/bootstrap 2>/dev/null || :)"
if [[ "$LAN_STATUS" != 401 ]]; then
  cp -p -- "$BACKUP" "$CFILE"
  docker restart "$PROXY" >/dev/null 2>&1 || :
  fail "Prior LAN beta HTTPS route no longer returns verified 401; restored gateway."
fi

notice 'Add ONLY new Tailscale Serve HTTPS 8444 listener'
if ! tailscale serve --bg --https=8444 http://127.0.0.1:18769 >/dev/null; then
  cp -p -- "$BACKUP" "$CFILE"
  docker restart "$PROXY" >/dev/null 2>&1 || :
  fail 'Tailscale Serve rejected new route; existing gateway restored.'
fi
AFTER="$(tailscale serve status)" || fail 'Tailscale Serve status unavailable after change.'
if [[ "$AFTER" != *"$TAIL_HOST:8443"* || "$AFTER" != *'http://127.0.0.1:8090'* ||
      "$AFTER" != *"$TAIL_HOST:8444"* || "$AFTER" != *'http://127.0.0.1:18769'* ]]; then
  echo 'REVIEW: Tailscale status differs from expected. Do not send photos yet.'
  echo 'Only the 8444 listener may be removed with: tailscale serve --https=8444 off'
  exit 1
fi
echo 'PASS: Existing Pixel Pals 8443 and separate ADHD beta 8444 mappings coexist.'
echo 'Open from a Tailscale-connected iPhone or CachyOS browser:'
echo 'https://tower.tarpon-drum.ts.net:8444'
echo 'Use the SAME beta login created for the independent LAN HTTPS gateway.'
echo 'Before sending photos verify the browser certificate is trusted and login works.'
echo 'Rollback: tailscale serve --https=8444 off (never tailscale serve reset).'

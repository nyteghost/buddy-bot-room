#!/usr/bin/env bash
# Add a *new* authenticated HTTPS site to the EXISTING Unraid Caddy process.
# Opt-in; existing :18765 route, Pixel Pals, native ADHD and beta app stay live.
set -Eeuo pipefail
set +x
umask 077

PROXY='adhd-assistant-lan'
DIR='/mnt/user/appdata/adhd-assistant/lan-proxy/conf'
IP='10.200.1.30'
BETA_HTTPS='18768'
BETA_BACKEND='18767'
MARK='# BEGIN ADHD PHOTO BETA HTTPS 18768'
TMP=''
CANDIDATE=''
cleanup(){ unset PASSWORD PASSWORD2 HASH || :; [[ -z "$CANDIDATE" ]] || rm -f -- "$CANDIDATE"; [[ -z "$TMP" ]] || rm -rf -- "$TMP"; }
trap cleanup EXIT
fail(){ printf 'BLOCKED: %s\n' "$*" >&2; exit 1; }
say(){ printf '\n== %s ==\n' "$*"; }

[[ "$EUID" -eq 0 ]] || fail 'Use the Unraid root terminal.'
for cmd in docker curl ip ss grep mktemp cp install mv stat date; do
  command -v "$cmd" >/dev/null 2>&1 || fail "Missing tool: $cmd"
done
[[ "$(docker inspect -f '{{.State.Running}}' "$PROXY" 2>/dev/null)" == true ]] ||
  fail 'Existing Caddy is not running.'
[[ "$(docker inspect -f '{{.HostConfig.NetworkMode}}' "$PROXY")" == host ]] ||
  fail 'Unexpected Caddy network: host-network route cannot be assumed.'
MOUNT="$(docker inspect -f '{{range .Mounts}}{{if eq .Destination "/etc/caddy"}}{{.Source}}{{end}}{{end}}' "$PROXY")"
[[ "$MOUNT" == "$DIR" ]] || fail 'Unexpected Caddy mount. Refusing unknown configuration.'
FILE="$DIR/Caddyfile"
[[ -f "$FILE" && ! -L "$FILE" ]] || fail 'Unexpected Caddyfile layout.'
[[ "$(stat -c '%h' "$FILE")" == 1 ]] || fail 'Unexpected linked Caddyfile.'
grep -Fq "$MARK" "$FILE" && fail 'Beta site already marked in Caddyfile.'
grep -Eq '10\.200\.1\.30:18768' "$FILE" && fail 'Beta IP/port already in Caddyfile.'

say 'Verify existing services and the new HTTPS port'
for n in buddy-bot-room adhd-assistant adhd-assistant-bridge adhd-assistant-photo-beta; do
  [[ "$(docker inspect -f '{{.State.Running}}' "$n" 2>/dev/null)" == true ]] ||
    fail "Required service not running: $n"
done
curl -fsS --max-time 5 "http://127.0.0.1:$BETA_BACKEND/health" >/dev/null ||
  fail 'Photo beta backend is not healthy.'
ip -4 -o addr show | grep -Eq '10\.200\.1\.30/' || fail 'Expected LAN IPv4 not assigned.'
LISTENERS="$(ss -ltnH)" || fail 'Cannot check TCP listeners.'
if printf '%s\n' "$LISTENERS" | awk -v port=":$BETA_HTTPS" '$4 ~ port"$" {found=1} END {exit !found}'; then
  fail 'New port 18768 is already in use.'
fi
printf '%s\n' "$LISTENERS" | awk '$4 ~ /:18765$/ {found=1} END {exit !found}' ||
  fail 'Production Caddy listener 18765 is unexpectedly missing.'
docker exec "$PROXY" caddy adapt --config /etc/caddy/Caddyfile --adapter caddyfile \
  >/dev/null 2>&1 || fail 'Current Caddyfile cannot be adapted; stop.'

say 'Choose an independent browser login'
echo 'The HTTPS site will bind only to the Unraid LAN IP, not to all interfaces.'
echo 'Caddy internal certificates require explicit trust on iPhone and CachyOS.'
read -r -p 'Beta login username [adhd-beta]: ' USER
[[ -n "$USER" ]] || USER='adhd-beta'
[[ "$USER" =~ ^[A-Za-z][A-Za-z0-9_.-]{1,31}$ ]] ||
  fail 'Username must be 2-32 ASCII characters, starting with a letter.'
read -r -s -p 'Beta password (14+ characters; hidden): ' PASSWORD
printf '\n'
read -r -s -p 'Confirm beta password (hidden): ' PASSWORD2
printf '\n'
[[ "$PASSWORD" == "$PASSWORD2" ]] || fail 'Passwords do not match.'
[[ "$(printf '%s' "$PASSWORD" | wc -c)" -ge 14 ]] ||
  fail 'Please use at least 14 characters.'
unset PASSWORD2
HASH="$(printf '%s\n' "$PASSWORD" | docker exec -i "$PROXY" \
  caddy hash-password --algorithm bcrypt 2>/dev/null)" ||
  fail 'Caddy could not hash password securely via stdin.'
unset PASSWORD
[[ "$HASH" =~ ^\$2[aby]\$[0-9][0-9]\$[A-Za-z0-9./]{53}$ ]] ||
  fail 'Caddy returned an unexpected password hash.'

TMP="$(mktemp -d /tmp/adhd-beta-caddy.XXXXXXXX)"
chmod 0700 "$TMP"
cp -p -- "$FILE" "$TMP/Caddyfile.before"
CANDIDATE="$DIR/.Caddyfile.adhd-photo-beta.$$"
# The candidate is an unreferenced hidden file, NOT the live Caddyfile.
# Keep it in the same directory so relative Caddy imports still resolve.
cp -p -- "$FILE" "$CANDIDATE"
{
  printf '\n%s\n' "$MARK"
  cat <<'SITE'
https://10.200.1.30:18768 {
    bind 10.200.1.30
    tls internal

    @foreignOrigin {
        header Origin *
        not header Origin https://10.200.1.30:18768
    }
    @denyBridge path /bridge/v1/*

    route {
SITE
  printf '        basic_auth {\n            %s %s\n        }\n' "$USER" "$HASH"
  cat <<'SITE'
        respond @foreignOrigin 403
        respond @denyBridge 404

        reverse_proxy http://127.0.0.1:18767 {
            header_up Host 127.0.0.1:18767
            header_up Origin http://127.0.0.1:18767
            header_up -Authorization
        }
    }
}
# END ADHD PHOTO BETA HTTPS 18768
SITE
} >> "$CANDIDATE"
unset HASH
chmod 0644 "$CANDIDATE"

say 'Validate the complete candidate with the CURRENT running Caddy version'
CNAME="/etc/caddy/$(basename "$CANDIDATE")"
docker exec "$PROXY" caddy adapt --config "$CNAME" --adapter caddyfile \
  >/dev/null 2>&1 || fail 'Caddyfile syntax rejected. No live change.'
docker exec "$PROXY" caddy validate --config "$CNAME" --adapter caddyfile \
  >/dev/null 2>&1 || fail 'Caddyfile provisioning rejected. No live change.'
echo 'Proposed additional site: https://10.200.1.30:18768'
echo 'Existing production :18765 and backend :18767 will remain unchanged.'
echo 'All beta paths will require Basic Auth before reaching the private backend.'
echo 'The installed Caddyfile will be backed up and the existing Caddy hot-reloaded.'
read -r -p 'Type ADD ADHD HTTPS BETA to apply: ' CONSENT
[[ "$CONSENT" == 'ADD ADHD HTTPS BETA' ]] ||
  fail 'Cancelled; original Caddyfile unchanged.'

say 'Back up original and perform scoped Caddy hot reload'
BACKUP="$DIR/Caddyfile.before-photo-beta-$(date -u +%Y%m%dT%H%M%SZ)"
cp -p -- "$FILE" "$BACKUP"
chmod 0600 "$BACKUP"
chown --reference="$FILE" "$CANDIDATE"
chmod --reference="$FILE" "$CANDIDATE"
mv -- "$CANDIDATE" "$FILE"
CANDIDATE=''
if ! docker exec "$PROXY" caddy reload --config /etc/caddy/Caddyfile \
  --adapter caddyfile >/dev/null 2>&1; then
  cp -p -- "$BACKUP" "$FILE"
  docker exec "$PROXY" caddy reload --config /etc/caddy/Caddyfile \
    --adapter caddyfile >/dev/null 2>&1 || :
  fail 'Caddy refused new route; original file restored. Review Caddy status.'
fi

status="$(curl -ksS --connect-timeout 3 --max-time 10 -o /dev/null \
  -w '%{http_code}' "https://$IP:$BETA_HTTPS/api/bootstrap" || :)"
if [[ "$status" != '401' ]]; then
  cp -p -- "$BACKUP" "$FILE"
  docker exec "$PROXY" caddy reload --config /etc/caddy/Caddyfile \
    --adapter caddyfile >/dev/null 2>&1 || :
  fail "Unauthenticated beta bootstrap returned HTTP $status, not 401. Reverted site."
fi
curl -fsS --max-time 5 "http://127.0.0.1:$BETA_BACKEND/health" >/dev/null ||
  fail 'Beta backend health check failed after HTTPS reload.'
echo
echo 'SUCCESS: Unauthenticated beta requests return 401.'
echo "Browser URL: https://$IP:$BETA_HTTPS"
echo "Beta username: $USER"
echo 'Important: trust Caddy internal CA on BOTH client devices before uploading any photos.'
echo 'Do not click through browser certificate warnings, publish port 18767, or share passwords.'
echo "Previous Caddy config backed up privately under $DIR."

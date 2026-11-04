#!/usr/bin/env bash
# Project Control Auto v1.0 — isolated, checksum-verified Unraid installation.
set -Eeuo pipefail
umask 077
DEST=/mnt/user/appdata/project-control-auto
BASE='https://raw.githubusercontent.com/nyteghost/buddy-bot-room/project-control-auto-v1/project-control-installer'
SHA256='1d5f96f0f96f1128bd144dcebcb045e8a084b88e375472257b4c3778689fa11c'
[[ $EUID -eq 0 ]] || { echo 'Open Unraid Terminal as root.' >&2; exit 1; }
for tool in curl tar xz base64 sha256sum docker; do
  command -v "$tool" >/dev/null || { echo "Missing required program: $tool" >&2; exit 1; }
done
if [[ -e "$DEST" ]] || docker container inspect project-control-auto >/dev/null 2>&1; then
  echo "An existing $DEST directory or project-control-auto container was found. Refusing to overwrite anything." >&2
  exit 1
fi
mkdir -p /mnt/user/appdata
TMP=$(mktemp -d /mnt/user/appdata/.project-control-setup.XXXXXXXX)
trap 'rm -rf "$TMP"' EXIT
printf '%s\n' 'Downloading Project Control Auto from verified GitHub files...'
for part in 00 01 02 03 04 05 06; do
  curl --proto '=https' --tlsv1.2 --fail --location --silent --show-error \
    --retry 3 --connect-timeout 12 --max-time 120 \
    "$BASE/payload.part${part}" >> "$TMP/payload.b64"
done
base64 -d "$TMP/payload.b64" > "$TMP/package.tar.xz"
echo "$SHA256  $TMP/package.tar.xz" | sha256sum -c -
mkdir "$TMP/app"
tar -xJf "$TMP/package.tar.xz" -C "$TMP/app" --no-same-owner --no-same-permissions
for f in app/pcc.py static/index.html config/projects.json scripts/start-unraid.sh scripts/setup-local.sh Dockerfile; do
  [[ -f "$TMP/app/$f" ]] || { echo "Invalid package: missing $f" >&2; exit 1; }
done
GH_TOKEN=''
if command -v gh >/dev/null 2>&1 && gh auth status --hostname github.com >/dev/null 2>&1; then
  printf '\n%s\n' 'An existing GitHub CLI login was detected on Unraid.'
  printf '%s\n' 'Its token may grant broader access than a dedicated read-only token.'
  read -r -p 'Reuse that GitHub CLI token for Project Control? [y/N]: ' REUSE_GH </dev/tty || {
    echo 'Interactive terminal required.' >&2; exit 1;
  }
  if [[ "$REUSE_GH" == [Yy] || "$REUSE_GH" == [Yy][Ee][Ss] ]]; then
    GH_TOKEN=$(gh auth token --hostname github.com) || {
      echo 'Unable to obtain GitHub CLI token.' >&2; exit 1;
    }
    printf '%s\n' 'Using saved GitHub CLI authentication without displaying the token.'
  fi
fi
if [[ -z "$GH_TOKEN" ]]; then
  printf '\n%s\n' 'For private repositories, create a fine-grained GitHub token at:'
  printf '%s\n' 'https://github.com/settings/personal-access-tokens/new'
  printf '%s\n' 'Restrict it to your project repositories and set Contents, Actions, Issues and Pull requests to READ-ONLY.'
  printf '%s\n' 'A dedicated token with narrow permissions is recommended.'
  read -r -s -p 'Paste your read-only GitHub token (hidden input): ' GH_TOKEN </dev/tty || {
    echo 'Interactive terminal required.' >&2; exit 1;
  }
  echo
fi
[[ -n "$GH_TOKEN" ]] || { echo 'Token is required; install canceled.' >&2; exit 1; }
IP="${PCC_BIND_IP:-}"
if [[ -z "$IP" ]] && command -v tailscale >/dev/null; then
  IP=$(tailscale ip -4 2>/dev/null | head -n1 || true)
fi
if [[ -z "$IP" ]] && command -v ip >/dev/null; then
  IP=$(ip -o -4 addr show dev tailscale0 2>/dev/null | awk '{split($4,a,"/"); print a[1]; exit}' || true)
fi
if [[ -z "$IP" ]]; then
  echo 'No Tailscale IPv4 detected. You can enter the host Tailscale IPv4 for remote access.'
  read -r -p 'Tailscale IPv4 (blank means local-only 127.0.0.1): ' IP </dev/tty || true
  IP=${IP:-127.0.0.1}
fi
if [[ ! $IP =~ ^[0-9]{1,3}(\.[0-9]{1,3}){3}$ ]] || [[ $IP == 0.0.0.0 ]]; then
  echo "Invalid bind address: $IP" >&2; exit 1
fi
IFS=. read -r p1 p2 p3 p4 <<< "$IP"
for octet in "$p1" "$p2" "$p3" "$p4"; do
  (( 10#$octet <= 255 )) || { echo "Invalid IPv4 octet: $octet" >&2; exit 1; }
done
mv "$TMP/app" "$DEST"
cd "$DEST"
bash scripts/setup-local.sh
printf '%s' "$GH_TOKEN" > secrets/github_token
unset GH_TOKEN
chmod 600 secrets/github_token
chown 1000:1000 secrets/github_token
sed -i "s/^PCC_BIND_IP=.*/PCC_BIND_IP=$IP/" .env
bash scripts/start-unraid.sh
# Wait for an actual authenticated HTTP health response inside the new container.
HEALTHY=0
for attempt in {1..15}; do
  if docker exec project-control-auto python -c 'import urllib.request,base64,os,pathlib,json; u=os.environ.get("PCC_DASHBOARD_USER","admin"); p=pathlib.Path("/run/secrets/dashboard_password").read_text().strip(); h=base64.b64encode((u+":"+p).encode()).decode(); req=urllib.request.Request("http://127.0.0.1:8788/api/health",headers={"Authorization":"Basic "+h}); d=json.load(urllib.request.urlopen(req, timeout=2)); assert d["service"]=="ready"' >/dev/null 2>&1; then
    HEALTHY=1
    break
  fi
  sleep 1
done
if [[ $HEALTHY != 1 ]]; then
  echo 'Container was created, but HTTP health is not ready. Examine: docker logs --tail=80 project-control-auto' >&2
  exit 1
fi
printf '\n%s\n' 'Project Control Auto is running; other containers were untouched.'
printf 'Dashboard address: http://%s:8788\n' "$IP"
printf '%s\n' 'Username: admin'
printf '%s\n' 'Password shown below (keep private):'
cat secrets/dashboard_password
printf '\n%s\n' 'Check status: docker logs --tail=60 project-control-auto'

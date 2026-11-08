#!/usr/bin/env bash
# Owner-triggered install of ONE isolated beta service in EXISTING pixelpals Compose project.
# No production container restarts, no production appdata mounts, no Caddy edits.
set -Eeuo pipefail
umask 077

PROJECT=/boot/config/plugins/compose.manager/projects/pixelpals
BASE=/mnt/user/appdata/adhd-assistant-photo-beta
CODE="$BASE/code"
DATA="$BASE/data"
OVERLAY="$PROJECT/docker-compose.photo-beta.yml"
PORT=18767
OLLAMA=http://10.200.1.149:11434
SOURCE_COMMIT=dea34ad7d2e624b6d86c8a4cfdb549e62c10cebe
BETA_COMMIT=5c1e05b1c39f365c57a339de06a5d2086cd12e06

fail(){ printf 'BLOCKED: %s\n' "$*" >&2; exit 1; }
step(){ printf '\n== %s ==\n' "$*"; }
TMP=''
GH_PAT=''
cleanup(){ if [[ -n "$TMP" ]]; then rm -rf -- "$TMP"; fi; unset GH_PAT || :; }
trap cleanup EXIT

[[ "$EUID" -eq 0 ]] || fail 'Run in the Unraid root terminal.'
for cmd in docker curl tar ss install awk grep find mktemp cp chown chmod; do
  command -v "$cmd" >/dev/null 2>&1 || fail "Missing command $cmd"
done
[[ -f "$PROJECT/docker-compose.yml" && -f "$PROJECT/docker-compose.override.yml" ]] ||
  fail 'Active Pixel Pals Compose base and override files not found.'
for p in "$BASE" "$CODE" "$DATA" "$OVERLAY"; do
  [[ ! -L "$p" ]] || fail "Symlink at $p"
done
[[ ! -e "$OVERLAY" ]] || fail 'Pilot overlay already exists; refusing overwrite.'

step 'Verify production services remain healthy'
for name in buddy-bot-room adhd-assistant adhd-assistant-bridge; do
  docker container inspect "$name" >/dev/null 2>&1 || fail "Missing container $name"
  project="$(docker inspect --format '{{index .Config.Labels "com.docker.compose.project"}}' "$name")"
  state="$(docker inspect --format '{{.State.Status}}' "$name")"
  [[ "$project" == pixelpals && "$state" == running ]] ||
    fail "$name is not a running member of pixelpals"
  printf 'Preserving: %s\n' "$name"
done
if docker container inspect adhd-assistant-photo-beta >/dev/null 2>&1; then
  fail 'Pilot container already exists; will not recreate it.'
fi
services="$(cd "$PROJECT" && docker compose -p pixelpals \
  -f docker-compose.yml -f docker-compose.override.yml config --services)" ||
  fail 'Active Compose config could not be read.'
for svc in buddy-bot adhd-assistant adhd-bridge whisper whisper-pull; do
  grep -qxF "$svc" <<< "$services" || fail "Expected service missing: $svc"
done
listeners="$(ss -ltnH)" || fail 'Cannot inspect listening TCP ports.'
if printf '%s\n' "$listeners" | awk -v x=":$PORT" \
  'index($4,x) && substr($4,length($4)-length(x)+1)==x {found=1} END {exit !found}'; then
  fail "Port $PORT is occupied. No services will be stopped."
fi
printf 'TCP %s free; existing Caddy listener 18765 untouched.\n' "$PORT"

step 'Verify existing gaming-PC Ollama'
tags="$(curl --fail --silent --show-error --connect-timeout 5 --max-time 12 "$OLLAMA/api/tags")" ||
  fail 'Gaming-PC Ollama not reachable.'
[[ "$tags" == *'qwen3-vl:4b'* ]] || fail 'Installed qwen3-vl:4b model not found.'
unset tags
echo 'Ollama image model confirmed.'

for p in "$BASE" "$CODE" "$DATA"; do
  [[ ! -e "$p" || -d "$p" ]] || fail "Unexpected file at $p"
done
for p in "$CODE" "$DATA"; do
  if [[ -d "$p" && -n "$(find "$p" -mindepth 1 -print -quit)" ]]; then
    fail "Staging path not empty: $p. Refusing overwrite."
  fi
done
docker image inspect python:3.12-alpine >/dev/null 2>&1 ||
  fail 'python:3.12-alpine image missing; automatic pull is disabled.'

TMP="$(mktemp -d -t adhd-photo-beta.XXXXXXXX)"
chmod 0700 "$TMP"
step 'Download pinned public beta Compose overlay'
curl -fsSL --proto '=https' --proto-redir '=https' \
  --connect-timeout 10 --max-time 90 \
  "https://raw.githubusercontent.com/nyteghost/buddy-bot-room/$BETA_COMMIT/tools/adhd-v02/photo-beta-service.yml" \
  -o "$TMP/overlay.yml" || fail 'Overlay download failed.'
grep -q '^  adhd-assistant-photo-beta:' "$TMP/overlay.yml" ||
  fail 'Unrecognized beta service overlay.'
grep -Fq '18767' "$TMP/overlay.yml" || fail 'Beta service overlay port mismatch.'

step 'Download exact private ADHD Assistant feature version'
if command -v gh >/dev/null 2>&1 && gh auth status >/dev/null 2>&1; then
  GH_PAT="$(gh auth token)" || fail 'GitHub CLI login is unavailable.'
  echo 'Using authenticated GitHub CLI credentials.'
else
  echo 'A GitHub fine-grained token with Contents: Read for private nyteghost/adhd-assistant is required.'
  echo 'Do NOT paste the token into chat. Paste only at the hidden prompt below.'
  read -r -s -p 'GitHub read-only token (hidden): ' GH_PAT
  printf '\n'
fi
[[ -n "$GH_PAT" ]] || fail 'No private GitHub authentication provided.'
# Deliver header in a private input FD; token not in shell history or curl argv.
curl -fsSL --proto '=https' --proto-redir '=https' \
  --connect-timeout 10 --max-time 180 \
  --config /dev/fd/3 -H 'Accept: application/vnd.github+json' \
  -o "$TMP/source.tar.gz" \
  "https://api.github.com/repos/nyteghost/adhd-assistant/tarball/$SOURCE_COMMIT" \
  3<<<"header = \"Authorization: Bearer $GH_PAT\"" ||
  fail 'Private GitHub download failed. Verify token read access.'
unset GH_PAT

mkdir -p "$TMP/source"
tar -xzf "$TMP/source.tar.gz" -C "$TMP/source" \
  --strip-components=1 --no-same-owner --no-same-permissions ||
  fail 'Unpacking private source failed.'
for name in launch.py adhd_assistant/server.py adhd_assistant/photo_guidance.py web/app.js web/index.html; do
  [[ -f "$TMP/source/$name" ]] || fail "Downloaded source missing $name"
done
[[ -z "$(find "$TMP/source" -type l -print -quit)" ]] ||
  fail 'Unexpected symlinks in downloaded source.'

step 'Validate combined existing-stack configuration WITHOUT starting anything'
export ADHD_PHOTO_BETA_CODE_PATH="$CODE"
export ADHD_PHOTO_BETA_DATA_PATH="$DATA"
export ADHD_PHOTO_BETA_PORT="$PORT"
export ADHD_PHOTO_BETA_OLLAMA_URL="$OLLAMA"
(
  cd "$PROJECT"
  docker compose -p pixelpals \
    -f docker-compose.yml -f docker-compose.override.yml \
    -f "$TMP/overlay.yml" --profile adhd-photo-beta config --quiet
) || fail 'Combined Compose config failed validation.'

echo
echo 'Will add ONLY adhd-assistant-photo-beta to EXISTING pixelpals project.'
echo "New test code: $CODE"
echo "New EMPTY test data: $DATA"
echo "Host-loopback test port: $PORT (not LAN/public)"
echo 'No existing containers, proxy listeners, production data or services will be modified.'
printf 'Type INSTALL PHOTO BETA to approve: '
IFS= read -r confirmation
[[ "$confirmation" == 'INSTALL PHOTO BETA' ]] ||
  fail 'Cancelled; no installation performed.'

step 'Install isolated code, data folder and new Compose service file'
install -d -o 99 -g 100 -m 0750 "$BASE" "$DATA"
install -d -o 99 -g 100 -m 0755 "$CODE"
cp -a "$TMP/source/." "$CODE/" || fail 'Cannot copy source to beta-only directory.'
chown -R 99:100 "$CODE" "$DATA"
chmod 0750 "$DATA"
install -m 0644 "$TMP/overlay.yml" "$OVERLAY" ||
  fail 'Cannot create additive Compose overlay.'

step 'Start ONLY the pilot service, without dependencies'
(
  cd "$PROJECT"
  docker compose -p pixelpals \
    -f docker-compose.yml -f docker-compose.override.yml \
    -f "$OVERLAY" --profile adhd-photo-beta \
    up -d --no-deps --pull never adhd-assistant-photo-beta
) || fail 'Pilot service failed to start. Do NOT run full-stack Up.'

docker ps --filter name='^/adhd-assistant-photo-beta$' \
  --format 'table {{.Names}}\t{{.Status}}\t{{.Image}}'
if curl -fsS --connect-timeout 3 --max-time 5 "http://127.0.0.1:$PORT/health"; then
  echo
  echo 'Pilot web service health check succeeded.'
else
  echo 'Pilot container started; HTTP health pending. Inspect with:'
  echo 'docker logs --tail 80 adhd-assistant-photo-beta'
fi
echo
echo 'For your WINDOWS desktop PowerShell, create an SSH tunnel:'
echo "ssh -N -L $PORT:127.0.0.1:$PORT root@10.200.1.30"
echo "Then open http://127.0.0.1:$PORT on your Windows PC."
echo 'In the test app, set AI provider to Local Ollama and vision model to qwen3-vl:4b.'
echo 'Do NOT expose the native loopback-only server to iPhone/LAN until a reviewed HTTPS/auth route exists.'
echo 'The pilot overlay is additional to the existing two Compose Manager files; keep it for beta-only commands.'

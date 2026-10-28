#!/usr/bin/env bash
# Install/update a separate Pixel Pals beta stack through Unraid Compose Manager.
# Never change the existing stable pixelpals stack, its data, or its containers.
set -Eeuo pipefail

REPO="nyteghost/buddy-bot-room"
IMAGE="ghcr.io/$REPO:beta"
PROJECTS="/boot/config/plugins/compose.manager/projects"
STACK_DIR="$PROJECTS/pixelpals-beta"
COMPOSE_FILE="$STACK_DIR/docker-compose.yml"
APPDATA="/mnt/user/appdata/pixelpals-beta"
RAW_URL="https://raw.githubusercontent.com/$REPO/beta/docker-compose.unraid-beta.yml"
BUILD_DIR=""

cleanup() {
  if [ -n "$BUILD_DIR" ] && [ -d "$BUILD_DIR" ]; then rm -rf -- "$BUILD_DIR"; fi
}
trap cleanup EXIT

say() { printf '\n[Pixel Pals Beta] %s\n' "$*"; }
fail() { printf '\n[Pixel Pals Beta] ERROR: %s\n' "$*" >&2; exit 1; }

[ "$(id -u)" -eq 0 ] || fail "Run this in the Unraid terminal as root."
command -v docker >/dev/null 2>&1 || fail "Docker is unavailable. Enable the Docker service in Unraid."
docker compose version >/dev/null 2>&1 || fail "Docker Compose is unavailable. Enable the Compose Manager plugin."
command -v curl >/dev/null 2>&1 || fail "curl is required."
[ -d "$PROJECTS" ] || fail "Compose Manager projects directory was not found: $PROJECTS"
[ "$STACK_DIR" != "$PROJECTS/pixelpals" ] || fail "Refusing to overwrite the stable stack."

say "Setting up an isolated beta stack (port 8091, separate appdata)."
mkdir -p "$STACK_DIR" "$APPDATA/data" "$APPDATA/backups"

if [ -f "$COMPOSE_FILE" ]; then
  grep -q 'ghcr.io/nyteghost/buddy-bot-room:beta' "$COMPOSE_FILE" ||
    fail "An existing pixelpals-beta stack has a different configuration. Not overwriting it."
  say "Existing beta Compose configuration found; keeping your settings."
else
  curl --fail --location --silent --show-error --retry 2 \
    "$RAW_URL" -o "$COMPOSE_FILE.tmp" ||
    fail "Could not download the beta Compose file from GitHub."
  grep -q 'ghcr.io/nyteghost/buddy-bot-room:beta' "$COMPOSE_FILE.tmp" ||
    fail "The downloaded Compose file was not the expected beta file."
  mv "$COMPOSE_FILE.tmp" "$COMPOSE_FILE"
fi

if [ ! -f "$STACK_DIR/.env" ]; then
  # Reuse the existing Ollama address if accessible; never copy stable credentials.
  AI_URL="$(printenv BETA_OLLAMA_URL 2>/dev/null || true)"
  if [ -z "$AI_URL" ]; then
    AI_URL="$(docker inspect --format '{{range .Config.Env}}{{println .}}{{end}}' buddy-bot-room 2>/dev/null | sed -n 's/^OLLAMA_URL=//p' | head -n 1 || true)"
    case "$AI_URL" in
      http://ollama:11434|https://ollama:11434)
        HOST_PORT="$(docker port buddy-ollama 11434/tcp 2>/dev/null | head -n 1 | awk -F: '{print $NF}' || true)"
        if [ -n "$HOST_PORT" ]; then
          AI_URL="http://host.docker.internal:$HOST_PORT"
        else
          AI_URL=""
        fi
        ;;
    esac
  fi
  case "$AI_URL" in
    ""|http://*|https://*) ;;
    *) AI_URL="";;
  esac
  printf 'BETA_OLLAMA_URL=%s\n' "$AI_URL" > "$STACK_DIR/.env"
  chmod 600 "$STACK_DIR/.env"
fi

[ -f "$STACK_DIR/name" ] || printf 'pixelpals-beta\n' > "$STACK_DIR/name"
[ -f "$STACK_DIR/description" ] || printf 'Pixel Pals beta testing. Isolated from stable; web port 8091.\n' > "$STACK_DIR/description"
[ -f "$STACK_DIR/autostart" ] || printf 'true\n' > "$STACK_DIR/autostart"

cd "$STACK_DIR"
docker compose -f "$COMPOSE_FILE" config --quiet ||
  fail "Docker Compose could not validate the beta configuration."

say "Pulling the beta container image (this does not touch :latest)."
if docker pull "$IMAGE"; then
  say "Beta image downloaded."
else
  say "The beta image is not published or reachable yet; building the beta branch locally instead."
  BUILD_DIR="$(mktemp -d "$APPDATA/.beta-build.XXXXXXXX")"
  curl --fail --location --silent --show-error --retry 2 \
    "https://codeload.github.com/$REPO/tar.gz/refs/heads/beta" \
    -o "$BUILD_DIR/source.tgz" ||
    fail "Cannot download beta source from GitHub. Check network access."
  mkdir -p "$BUILD_DIR/source"
  tar -xzf "$BUILD_DIR/source.tgz" --strip-components=1 -C "$BUILD_DIR/source" ||
    fail "Could not unpack the beta source archive."
  docker build --target prod -t "$IMAGE" "$BUILD_DIR/source" ||
    fail "Local beta image build failed; your stable stack is untouched."
fi

say "Starting the beta stack..."
docker compose -f "$COMPOSE_FILE" up -d --pull never ||
  fail "Beta container failed to start. Check: docker logs pixelpals-beta"

# A first request creates the one-time initial account setup code if needed.
for attempt in $(seq 1 30); do
  http_status="$(curl --silent --output /dev/null --write-out '%{http_code}' "http://127.0.0.1:8091/" || true)"
  if [ "$http_status" = "401" ] || [ "$http_status" = "200" ]; then
    break
  fi
  sleep 2
done

say "Pixel Pals Beta stack created at: $STACK_DIR"
say "Open: http://YOUR-UNRAID-IP:8091"
if [ -f "$APPDATA/data/initial-setup.code" ]; then
  printf '\nFIRST-RUN SETUP CODE (for the beta owner account):\n'
  cat "$APPDATA/data/initial-setup.code"
  printf '\nKeep this code private. It is deleted after the first beta account is created.\n'
fi
say "Stable Pixel Pals remains on its original stack and port 8090."
say "For future beta updates: Docker > Compose > pixelpals-beta > Update Stack."

#!/usr/bin/env bash
# READ-ONLY Unraid preflight for adding ADHD photo beta to EXISTING pixelpals project.
# Does not create files, start containers, print environment variables or read secrets.
set -u

result=0
echo '== Pixel Pals / ADHD photo beta read-only preflight =='
echo 'No Docker or Compose changes are performed by this script.'
echo

if ! command -v docker >/dev/null 2>&1; then
  echo 'BLOCKED: Docker command not available.'
  exit 1
fi

for name in buddy-bot-room adhd-assistant adhd-assistant-bridge; do
  if ! docker container inspect "$name" >/dev/null 2>&1; then
    echo "BLOCKED: Expected existing container $name not found."
    exit 1
  fi
  project="$(docker inspect --format '{{index .Config.Labels "com.docker.compose.project"}}' "$name" 2>/dev/null)"
  service="$(docker inspect --format '{{index .Config.Labels "com.docker.compose.service"}}' "$name" 2>/dev/null)"
  state="$(docker inspect --format '{{.State.Status}}' "$name" 2>/dev/null)"
  health="$(docker inspect --format '{{if .State.Health}}{{.State.Health.Status}}{{else}}not-configured{{end}}' "$name" 2>/dev/null)"
  printf '%s: project=%s service=%s state=%s health=%s\n' "$name" "$project" "$service" "$state" "$health"
  if [[ "$project" != "pixelpals" ]]; then
    echo "BLOCKED: $name is not labeled as belonging to the pixelpals Compose project."
    exit 1
  fi
  if [[ "$state" != "running" ]]; then
    echo "BLOCKED: $name is not running; investigate before staging."
    exit 1
  fi
done

echo
echo '== Active Compose metadata (names/paths only; no environment or Compose contents) =='
docker inspect --format 'working_dir={{index .Config.Labels "com.docker.compose.project.working_dir"}}' buddy-bot-room
docker inspect --format 'config_files={{index .Config.Labels "com.docker.compose.project.config_files"}}' buddy-bot-room
echo 'The paths above must be reviewed against Compose Manager before modifying the stack.'
echo

echo '== Staging container and port =='
if docker container inspect adhd-assistant-photo-beta >/dev/null 2>&1; then
  echo 'BLOCKED: staging container name adhd-assistant-photo-beta already exists.'
  exit 1
fi
echo 'Staging container name: unused.'
if command -v ss >/dev/null 2>&1; then
  if ss -ltnH | awk '$4 ~ /:18765$/ {found=1} END {exit !found}'; then
    echo 'BLOCKED: proposed host loopback port 18765 is already listening.'
    result=1
  fi
  echo 'Proposed staging TCP port 18765: no listener shown by ss.'
else
  echo 'UNVERIFIED: ss unavailable; check TCP port 18765 on Unraid manually.'
  result=1
fi

echo
echo '== Gaming-PC Ollama connectivity =='
if ! command -v curl >/dev/null 2>&1; then
  echo 'UNVERIFIED: curl unavailable; cannot check gaming-PC Ollama.'
  result=1
else
  # Non-mutating GET, responses are not printed (may reveal local model metadata).
  tags="$(curl -fsS --connect-timeout 3 --max-time 8 http://10.200.1.149:11434/api/tags 2>/dev/null)" || tags=""
  if [[ -z "$tags" ]]; then
    echo 'BLOCKED: Unraid host cannot retrieve model tags from 10.200.1.149:11434.'
    result=1
  elif [[ "$tags" == *'qwen3-vl:4b'* ]]; then
    echo 'Gaming-PC Ollama reachable; qwen3-vl:4b appears in /api/tags.'
  else
    echo 'UNVERIFIED: Ollama reachable but qwen3-vl:4b is not in the returned tags.'
    result=1
  fi
fi

echo
echo '== Source and storage isolation =='
echo 'Proposed paths:'
echo '  /mnt/user/appdata/adhd-assistant-photo-beta/code'
echo '  /mnt/user/appdata/adhd-assistant-photo-beta/data'
for path in /mnt/user/appdata/adhd-assistant-photo-beta/code /mnt/user/appdata/adhd-assistant-photo-beta/data; do
  if [[ -e "$path" ]]; then
    echo "REVIEW: $path already exists; ensure it contains no live data and is not a symlink."
  else
    echo "OK: $path does not exist yet."
  fi
done

echo
echo 'NEXT GATES: inspect actual active Compose file and native Caddy/HTTPS/auth.'
echo 'The iPhone photo upload is NOT safe to expose directly from this loopback-only app.'
echo 'No production container has been stopped, restarted, created or changed.'
if (( result != 0 )); then
  echo 'PREFLIGHT INCOMPLETE: resolve blocked/unverified checks before staging.'
  exit 1
fi
echo 'STATIC PREFLIGHT PASSED. Deployment and iPhone proxy remain unapproved/unverified.'

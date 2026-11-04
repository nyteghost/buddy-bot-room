#!/usr/bin/env bash
# Port conflict recovery. Only changes project-control-auto, never the service currently holding 8788.
set -Eeuo pipefail
umask 077
APP=/mnt/user/appdata/project-control-auto
NAME=project-control-auto
[[ $EUID -eq 0 ]] || { echo 'Run in Unraid root terminal.' >&2; exit 1; }
for f in "$APP/.env" "$APP/scripts/start-unraid.sh" "$APP/secrets/dashboard_password" "$APP/secrets/github_token"; do
  [[ -f "$f" ]] || { echo "Missing $f; no changes made." >&2; exit 1; }
done
START="$APP/scripts/start-unraid.sh"
ORIGINAL='--publish "${PCC_BIND_IP}:8788:8788"'
PATCHED='--publish "${PCC_BIND_IP}:${PCC_HOST_PORT:-8788}:8788"'
if ! grep -Fq -- "$ORIGINAL" "$START" && ! grep -Fq -- "$PATCHED" "$START"; then
  echo 'Unrecognized Project Control startup script; no changes made.' >&2
  exit 1
fi
if docker container inspect "$NAME" >/dev/null 2>&1; then
  image=$(docker inspect --format '{{.Config.Image}}' "$NAME")
  [[ "$image" == 'project-control-auto:1.0' ]] || { echo "Unexpected container image $image. Refusing to change it." >&2; exit 1; }
  running=$(docker inspect --format '{{.State.Running}}' "$NAME")
  if [[ "$running" == true ]]; then
    echo 'Project Control is already running. No changes made.'
    docker ps --filter "name=^/${NAME}$" --format 'table {{.Names}}\t{{.Status}}\t{{.Ports}}'
    exit 0
  fi
fi
bind_ip=$(sed -n 's/^PCC_BIND_IP=//p' "$APP/.env" | tail -n1 | tr -d '\r')
if [[ ! "$bind_ip" =~ ^([0-9]{1,3}\.){3}[0-9]{1,3}$ || "$bind_ip" == '0.0.0.0' ]]; then
  echo "Invalid/unsafe PCC_BIND_IP in .env; no changes made." >&2
  exit 1
fi
mkdir -p "$APP/repair-backups"
BACKUP="$APP/repair-backups/port-repair-$(date -u +%Y%m%dT%H%M%SZ)"
mkdir "$BACKUP"
cp -p "$START" "$APP/.env" "$BACKUP/"
if docker container inspect "$NAME" >/dev/null 2>&1; then
  docker inspect "$NAME" > "$BACKUP/container-inspect.json"
fi
# Make host port configurable. Internal API remains on container port 8788.
if ! grep -Fq -- "$PATCHED" "$START"; then
  sed -i 's@--publish "${PCC_BIND_IP}:8788:8788"@--publish "${PCC_BIND_IP}:${PCC_HOST_PORT:-8788}:8788"@' "$START"
fi
if ! grep -Fq -- "$PATCHED" "$START"; then
  echo 'Could not patch launch port; original script saved in backup.' >&2
  exit 1
fi
busy() {
  local port="$1"
  if command -v ss >/dev/null 2>&1 && ss -H -l -t -n 2>/dev/null | awk '{print $4}' | grep -Eq "[:.]${port}\$"; then
    return 0
  fi
  if docker ps --format '{{.Ports}}' | grep -Fq ":${port}->"; then
    return 0
  fi
  return 1
}
for port in 8789 8790 8791 8792 8793 8794 8795 8796 8797 8798 8799; do
  if busy "$port"; then
    echo "Port $port is already in use; skipping."
    continue
  fi
  # Remove only a stopped container whose image belongs to this app.
  if docker container inspect "$NAME" >/dev/null 2>&1; then
    image=$(docker inspect --format '{{.Config.Image}}' "$NAME")
    running=$(docker inspect --format '{{.State.Running}}' "$NAME")
    [[ "$image" == 'project-control-auto:1.0' && "$running" != true ]] || { echo 'Container state changed; stopping without modifying it.' >&2; exit 1; }
    docker rm "$NAME" >/dev/null
  fi
  if grep -q '^PCC_HOST_PORT=' "$APP/.env"; then
    sed -i "s/^PCC_HOST_PORT=.*/PCC_HOST_PORT=$port/" "$APP/.env"
  else
    printf '\nPCC_HOST_PORT=%s\n' "$port" >> "$APP/.env"
  fi
  echo "Starting Project Control at ${bind_ip}:${port}; other services unchanged."
  LOG=$(mktemp)
  if (cd "$APP" && bash scripts/start-unraid.sh) >"$LOG" 2>&1; then
    cat "$LOG"; rm -f "$LOG"
    HEALTHY=0
    for i in $(seq 1 20); do
      if docker exec "$NAME" python -c 'import urllib.request,base64,os,pathlib,json; u=os.environ.get("PCC_DASHBOARD_USER","admin"); p=pathlib.Path("/run/secrets/dashboard_password").read_text().strip(); auth=base64.b64encode((u+":"+p).encode()).decode(); req=urllib.request.Request("http://127.0.0.1:8788/api/health",headers={"Authorization":"Basic "+auth}); body=json.load(urllib.request.urlopen(req,timeout=2)); assert body["service"]=="ready"' >/dev/null 2>&1; then
        HEALTHY=1; break
      fi
      sleep 2
    done
    docker ps --filter "name=^/${NAME}$" --format 'table {{.Names}}\t{{.Status}}\t{{.Ports}}'
    if [[ $HEALTHY == 1 ]]; then
      printf '\nSUCCESS — dashboard: http://%s:%s\n' "$bind_ip" "$port"
      echo 'Username: admin'
      echo 'Password remains unchanged in secrets/dashboard_password (not printed).'
      echo 'GitHub private repository permissions still need to be corrected separately.'
      exit 0
    fi
    echo 'Container started but its health endpoint did not pass. Review logs:' >&2
    docker logs --tail 40 "$NAME" 2>&1 | sed -E 's/(github_pat_|gh[pousr]_)[A-Za-z0-9_]+/[REDACTED]/g' >&2
    exit 1
  else
    if grep -Eq 'port is already allocated|address already in use|port is already in use' "$LOG"; then
      echo "Docker also found port $port occupied; checking the next one."
      rm -f "$LOG"
      continue
    fi
    echo 'Docker returned a non-port error; no other service was modified:' >&2
    sed -E 's/(github_pat_|gh[pousr]_)[A-Za-z0-9_]+/[REDACTED]/g' "$LOG" | tail -30 >&2
    rm -f "$LOG"
    exit 1
  fi
done
echo 'No available host port found from 8789 to 8799; no other containers changed.' >&2
exit 1

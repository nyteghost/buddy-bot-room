#!/usr/bin/env bash
# Repair only Project Control's packaged code/assets permissions.
# Does not change GitHub credentials, Pixel Pals, or other containers.
set -Eeuo pipefail
umask 077
APP=/mnt/user/appdata/project-control-auto
NAME=project-control-auto

if [[ $EUID -ne 0 ]]; then
  echo 'Open the Unraid root terminal to run this repair.' >&2
  exit 1
fi
for d in app static config; do
  [[ -d "$APP/$d" ]] || { echo "Missing $APP/$d. Nothing changed." >&2; exit 1; }
done
for f in Dockerfile scripts/start-unraid.sh .env secrets/dashboard_password secrets/github_token; do
  [[ -f "$APP/$f" ]] || { echo "Missing $APP/$f. Nothing changed." >&2; exit 1; }
done
if ! docker container inspect "$NAME" >/dev/null 2>&1; then
  echo "Cannot find $NAME. Nothing changed." >&2
  exit 1
fi
IMAGE=$(docker inspect --format '{{.Config.Image}}' "$NAME")
if [[ $IMAGE != project-control-auto:1.0 ]]; then
  echo "Unexpected image $IMAGE; refusing to change the container." >&2
  exit 1
fi
mkdir -p "$APP/repair-backups"
BACKUP="$APP/repair-backups/container-inspect-$(date +%Y%m%d-%H%M%S).json"
docker inspect "$NAME" > "$BACKUP"
echo 'Saved container configuration backup (local only).'

# The original installer extracted files under umask 077. Docker runs as UID
# 1000, which could not read 0600 root-owned /app/app/__init__.py. Only public
# code/static/config permissions are repaired. Never chmod secrets or data.
chmod -R a+rX "$APP/app" "$APP/static" "$APP/config"
echo 'Repaired application file permissions. Secrets and project data unchanged.'

echo 'Building and validating the corrected image before replacing the container...'
docker build --tag project-control-auto:1.0 "$APP"
docker run --rm --user 1000:1000 --entrypoint python \
  project-control-auto:1.0 \
  -c 'import app.pcc, pathlib; assert pathlib.Path("/app/config/projects.json").is_file(); print("Non-root Python import and config read: OK")'

echo 'Recreating only the Project Control container...'
docker rm --force "$NAME" >/dev/null
(cd "$APP" && bash scripts/start-unraid.sh)

HEALTHY=0
for attempt in {1..15}; do
  if docker exec "$NAME" python -c 'import urllib.request,base64,os,pathlib,json; u=os.environ.get("PCC_DASHBOARD_USER","admin"); p=pathlib.Path("/run/secrets/dashboard_password").read_text().strip(); h=base64.b64encode((u+":"+p).encode()).decode(); req=urllib.request.Request("http://127.0.0.1:8788/api/health",headers={"Authorization":"Basic "+h}); d=json.load(urllib.request.urlopen(req, timeout=2)); assert d["service"]=="ready"' >/dev/null 2>&1; then
    HEALTHY=1
    break
  fi
  sleep 2
done

echo
printf '%s\n' '=== PROJECT CONTROL STATUS ==='
docker ps -a --filter 'name=^/project-control-auto$' --format 'table {{.Names}}\t{{.Status}}\t{{.Ports}}'
if [[ $HEALTHY == 1 ]]; then
  echo 'SUCCESS: Project Control HTTP health check passed.'
  echo 'The earlier GitHub private-repo HTTP 404 is a separate token-permission problem.'
else
  echo 'Project Control health check did not pass. See the startup logs below:' >&2
  docker logs --tail 35 "$NAME" 2>&1 | sed -E 's/(github_pat_|gh[pousr]_)[A-Za-z0-9_]+/[REDACTED]/g' >&2
  exit 1
fi

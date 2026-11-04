#!/usr/bin/env bash
# Project Control Safari login repair. Does not touch any other container.
set -Eeuo pipefail
umask 077
APP=/mnt/user/appdata/project-control-auto
NAME=project-control-auto
BASE=https://raw.githubusercontent.com/nyteghost/buddy-bot-room/d07cd5ce9938459ce614b5e843808375177d740e/project-control-installer/safari-login
EXPECTED_PCC=a0e4428628a84955944ebf9ca0fe0f0614f81d92c2564a48876dab9ca91d70cc
EXPECTED_AUTH=c5e9e37ba237207699ae4abf717fccfc008b8a4357f57b4cde9392e28ba21ebb
EXPECTED_HTML=80497832961250fb362ddb1613e32d6806c7e90f52ddd4d19311af28815ec179

[[ $EUID -eq 0 ]] || { echo 'Run in Unraid root terminal.' >&2; exit 1; }
for f in "$APP/app/pcc.py" "$APP/static/index.html" "$APP/Dockerfile" "$APP/scripts/start-unraid.sh" "$APP/.env" "$APP/secrets/dashboard_password"; do
  [[ -f "$f" ]] || { echo "Missing $f; refusing to change anything." >&2; exit 1; }
done
if ! docker container inspect "$NAME" >/dev/null 2>&1; then
  echo 'Project Control container not found. No changes made.' >&2; exit 1
fi
[[ "$(docker inspect --format '{{.Config.Image}}' "$NAME")" == 'project-control-auto:1.0' ]] || {
  echo 'Unexpected container image. No changes made.' >&2; exit 1
}
if grep -Fq 'install_safari_login(Handler)' "$APP/app/pcc.py"; then
  echo 'Safari login patch is already present. No changes made.'; exit 0
fi
[[ ! -e "$APP/app/safari_auth.py" && ! -e "$APP/static/login.html" ]] || {
  echo 'Unexpected existing Safari login files; no changes made.' >&2; exit 1
}
echo "$EXPECTED_PCC  $APP/app/pcc.py" | sha256sum -c - >/dev/null || {
  echo 'Project Control app has changed from the expected version; no changes made.' >&2; exit 1
}
[[ "$(grep -c "^if __name__ == '__main__':$" "$APP/app/pcc.py")" == 1 ]] || {
  echo 'Cannot locate unique startup marker; no changes made.' >&2; exit 1
}
mkdir -p "$APP/repair-backups"
BACKUP=$(mktemp -d "$APP/repair-backups/safari-login-XXXXXXXX")
cp -p "$APP/app/pcc.py" "$BACKUP/pcc.py"
docker inspect "$NAME" > "$BACKUP/container-inspect.json"
TMP=$(mktemp -d)
PATCHED=0
REMOVED=0
cleanup() {
  result=$?
  if [[ $result -ne 0 && $PATCHED == 1 ]]; then
    echo 'Patch unsuccessful. Restoring original Project Control application files...' >&2
    cp -p "$BACKUP/pcc.py" "$APP/app/pcc.py"
    rm -f "$APP/app/safari_auth.py" "$APP/static/login.html"
    if [[ $REMOVED == 1 ]]; then
      docker rm -f "$NAME" >/dev/null 2>&1 || true
      echo 'Attempting to restart the original Project Control version...' >&2
      (cd "$APP" && bash scripts/start-unraid.sh) || true
    fi
  fi
  rm -rf "$TMP"
}
trap cleanup EXIT

echo 'Downloading and verifying mobile login fix...'
curl --proto '=https' --tlsv1.2 -fsSL --retry 3 --connect-timeout 12 --max-time 40 "$BASE/safari_auth.py" -o "$TMP/safari_auth.py"
curl --proto '=https' --tlsv1.2 -fsSL --retry 3 --connect-timeout 12 --max-time 40 "$BASE/login.html" -o "$TMP/login.html"
echo "$EXPECTED_AUTH  $TMP/safari_auth.py" | sha256sum -c -
echo "$EXPECTED_HTML  $TMP/login.html" | sha256sum -c -

awk '/^if __name__ ==/ {
    print "from .safari_auth import install_safari_login"
    print "install_safari_login(Handler)"
    print ""
}
{print}' "$APP/app/pcc.py" > "$TMP/pcc.py"
cp "$TMP/pcc.py" "$APP/app/pcc.py"
cp "$TMP/safari_auth.py" "$APP/app/safari_auth.py"
cp "$TMP/login.html" "$APP/static/login.html"
PATCHED=1
chmod a+rX "$APP/app/pcc.py" "$APP/app/safari_auth.py" "$APP/static/login.html"

echo 'Building new image while existing dashboard remains running...'
docker build -t project-control-auto:1.0 "$APP" >/dev/null
docker run --rm --entrypoint python project-control-auto:1.0 -c 'import app.pcc; from pathlib import Path; assert "install_safari_login" in app.pcc.Handler.do_GET.__qualname__ or app.pcc.Handler.do_GET.__module__=="app.safari_auth"; assert (Path("/app/static/login.html")).is_file(); print("Login module smoke test passed")'

echo 'Restarting only the Project Control container; credentials and project data are preserved...'
docker rm -f "$NAME" >/dev/null
REMOVED=1
(cd "$APP" && bash scripts/start-unraid.sh) >/dev/null

HEALTHY=0
for attempt in $(seq 1 20); do
  if docker exec "$NAME" python -c 'import urllib.request; r=urllib.request.urlopen("http://127.0.0.1:8788/login", timeout=2); assert r.status==200 and b"name=\"password\"" in r.read()' >/dev/null 2>&1; then
    HEALTHY=1
    break
  fi
  sleep 2
done
if [[ $HEALTHY != 1 ]]; then
  echo 'Mobile login did not pass its HTTP test.' >&2
  docker logs --tail 30 "$NAME" 2>&1 | sed -E 's/(github_pat_|gh[pousr]_)[A-Za-z0-9_]+/[REDACTED]/g' >&2
  exit 1
fi
REMOVED=0
PATCHED=0
IP=$(sed -n 's/^PCC_BIND_IP=//p' "$APP/.env" | tail -n1)
PORT=$(sed -n 's/^PCC_HOST_PORT=//p' "$APP/.env" | tail -n1)
PORT=$(printf '%s' "$PORT" | tr -d '\r')
[[ -n "$PORT" ]] || PORT=8788
echo
echo 'SUCCESS — Mobile-friendly Project Control login is ready.'
printf 'Open in Safari: http://%s:%s/login\n' "$IP" "$PORT"
echo 'Username: admin. Your existing password is unchanged.'
echo 'Only Project Control was modified. Other containers and ports were untouched.'

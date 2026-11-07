#!/usr/bin/env bash
# One-pass diagnostic for Pixel Pals / ADHD Assistant on Unraid.
# When launched via curl | bash, only the Caddy JSON audit may read stdin.
# Every other docker -i invocation explicitly reads from /dev/null.
# Live app code, databases, Caddy, containers and network are never changed.
set -Eeuo pipefail
set +x
export LC_ALL=C

SOURCE_SHA='edae2e602489ff3dccf3dcfd567624b72b4dc31b'
SOURCE_BASE="https://raw.githubusercontent.com/nyteghost/buddy-bot-room/$SOURCE_SHA/tools/adhd-v02"
CODE_ROOT="${ADHD_AUDIT_CODE_ROOT:-/mnt/user/appdata/adhd-assistant/code}"
IMAGE='python:3.12-alpine'
AUDIT_HOST="$(printenv ADHD_AUDIT_HOST 2>/dev/null || true)"
if [ -z "$AUDIT_HOST" ]; then AUDIT_HOST='tower.tarpon-drum.ts.net'; fi
failures=0
skipped=0
stage=''

cleanup() {
  if [ -n "$stage" ] && [ -d "$stage" ]; then rm -rf -- "$stage"; fi
}
trap cleanup EXIT
pass() { printf 'PASS  %s\n' "$1"; }
warn() { printf 'CHECK %s\n' "$1"; failures=$((failures + 1)); }
skip() { printf 'SKIP  %s\n' "$1"; skipped=$((skipped + 1)); }
summary() {
  printf '\n=== Summary ===\nChecks requiring attention: %s\nSkipped checks: %s\n' "$failures" "$skipped"
  printf 'Live browser authentication: NOT TESTED\nLive task imports: NOT ATTEMPTED\nLive deployment authorized: NO\n'
  printf 'Existing applications, Caddy settings, and user data: NOT MODIFIED\n'
}

printf '=== Pixel Pals / ADHD Assistant: One-pass Unraid preflight ===\n'
printf 'Read-only inspections and disposable synthetic-data tests only.\n'
printf 'No credentials, hashes, private task content or tokens are intentionally printed.\n'
case "$AUDIT_HOST" in
  ''|*/*|*:*|*' '*|*'\\'*)
    printf 'REFUSED: audit hostname must be a simple DNS name without port or scheme.\n'
    exit 2 ;;
esac
for binary in docker curl; do
  if ! command -v "$binary" >/dev/null 2>&1; then
    printf 'REFUSED: required command missing: %s\n' "$binary"
    exit 2
  fi
done

printf '\n=== 1. Running container state (names/status only) ===\n'
for name in buddy-bot-room adhd-assistant adhd-assistant-bridge adhd-assistant-lan; do
  if docker inspect --type=container "$name" >/dev/null 2>&1; then
    state="$(docker inspect --format '{{.State.Status}}' "$name" 2>/dev/null || true)"
    health="$(docker inspect --format '{{if .State.Health}}{{.State.Health.Status}}{{else}}not-configured{{end}}' "$name" 2>/dev/null || true)"
    if [ "$state" = 'running' ]; then
      pass "$name running; health=$health"
    else
      warn "$name not running; state=$state; health=$health"
    fi
  else
    skip "$name not found under this container name"
  fi
done

printf '\n=== 2. Installed source and offline test prerequisites ===\n'
if [ ! -f "$CODE_ROOT/adhd_assistant/server.py" ] || [ ! -f "$CODE_ROOT/adhd_assistant/database.py" ]; then
  warn 'Installed ADHD source files not found at the verified appdata location'
  summary
  exit 0
fi
pass 'Installed ADHD source files found (read-only access used)'
if ! docker image inspect "$IMAGE" >/dev/null 2>&1; then
  warn 'Disposable Python image not present; no automatic pull attempted'
  summary
  exit 0
fi
pass 'Offline Python image already present'

stage="$(mktemp -d /tmp/adhd-onepass.XXXXXXXX)"
chmod 0755 "$stage"
for filename in \
  approved_task_export.py native_handoff_reconcile.py native_local_intake.py \
  native_review_inbox.py native_review_http.py native_review_page.html \
  prepare-native-review-patch.py stage_native_local_intake.py \
  audit_native_review_proxy.py \
  test_native_handoff_reconcile.py test_native_local_intake.py \
  test_native_review_inbox.py test_native_review_http.py \
  test_prepare_native_review_patch.py test_audit_native_review_proxy.py
do
  if ! curl --fail --silent --show-error --location --connect-timeout 10 \
    --max-time 35 --retry 2 "$SOURCE_BASE/$filename" --output "$stage/$filename"; then
    warn 'A pinned public source dependency could not be downloaded; tests were skipped'
    summary
    exit 0
  fi
done
chmod 0444 "$stage"/*
pass 'Read-only diagnostic modules fetched to disposable /tmp only'

isolated() {
  docker run --rm --pull never -i --network none --read-only \
    --user 99:100 --cap-drop ALL --security-opt no-new-privileges \
    --pids-limit 64 --memory 256m \
    --tmpfs /tmp:rw,nosuid,nodev,size=96m,mode=1777 \
    --env PYTHONDONTWRITEBYTECODE=1 \
    --env PYTHONPATH=/opt/adhd:/checks \
    --mount "type=bind,src=$CODE_ROOT,dst=/opt/adhd,readonly" \
    --mount "type=bind,src=$stage,dst=/checks,readonly" \
    "$IMAGE" "$@"
}

printf '\n=== 3. Native server route compatibility / security preflight ===\n'
if isolated python -B /checks/prepare-native-review-patch.py --source-root /opt/adhd </dev/null; then
  pass 'Native server layout inspected; compatibility is not deployment approval'
else
  warn 'Native server layout/auth source inspection failed'
fi

printf '\n=== 4. Synthetic inbox / Caddy security regression suite ===\n'
if isolated python -B -m unittest -q \
  test_audit_native_review_proxy test_prepare_native_review_patch \
  test_native_review_http test_native_review_inbox </dev/null; then
  pass 'Offline unit tests passed; installed user data not mounted'
else
  warn 'Offline security and inbox unit tests did not pass'
fi

printf '\n=== 5. Real native Store code, disposable task/database ===\n'
if docker run --rm --pull never --network none --read-only \
  --user 99:100 --cap-drop ALL --security-opt no-new-privileges \
  --pids-limit 64 --memory 256m \
  --tmpfs /tmp:rw,nosuid,nodev,size=96m,mode=1777 \
  --env PYTHONDONTWRITEBYTECODE=1 \
  --env PYTHONPATH=/opt/adhd:/checks \
  --env ADHD_STAGING_ONLY=1 \
  --mount "type=bind,src=$CODE_ROOT,dst=/opt/adhd,readonly" \
  --mount "type=bind,src=$stage,dst=/checks,readonly" \
  "$IMAGE" python -B /checks/stage_native_local_intake.py </dev/null; then
  pass 'Native task audit, backup, and duplicate safeguards passed with test data'
else
  warn 'Disposable native Store rehearsal failed'
fi

printf '\n=== 6. Redacted Caddy route / auth / headers audit ===\n'
if docker inspect --type=container adhd-assistant-lan >/dev/null 2>&1; then
  # IMPORTANT: adapted JSON may contain credential hashes and token values.
  # Never print, tee, save, or upload it. The parser only prints booleans.
  if docker exec adhd-assistant-lan caddy adapt \
      --config /etc/caddy/Caddyfile 2>/dev/null \
      | isolated python -B /checks/audit_native_review_proxy.py --host "$AUDIT_HOST"; then
    pass 'Static proxy route audit completed; browser auth still unverified'
  else
    warn 'Static proxy route inspection failed or configuration unsupported'
  fi
else
  skip 'Caddy container not found; route audit unavailable'
fi

summary
printf 'You can share this report with ChatGPT without sharing any secrets.\n'
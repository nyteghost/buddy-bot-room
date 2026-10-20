#!/bin/sh
# Creates the one login from RADICALE_USER / RADICALE_PASSWORD, then starts Radicale.
set -e
if [ -z "$RADICALE_PASSWORD" ]; then
  echo "Set RADICALE_PASSWORD (any long password) in the stack's environment variables." >&2
  exit 1
fi
USER_NAME="${RADICALE_USER:-pixelpals}"
umask 077
printf '%s:%s\n' "$USER_NAME" "$RADICALE_PASSWORD" > /config/users
exec python -m radicale --config /etc/radicale/config

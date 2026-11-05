#!/usr/bin/env bash
# ADHD Assistant v0.2.0-beta bridge-enabled overlay for the known Unraid v0.1.0 Docker install.
# Upgrades bridge transport without overwriting /data or changing Pixel Pals or Caddy.
set -Eeuo pipefail

BASE=/mnt/user/appdata/adhd-assistant
APP="$BASE/code"
DATA="$BASE/data"
CONTAINER=adhd-assistant
PORT=18766

say(){ printf '\n[ADHD-A v0.2] %s\n' "$*"; }
die(){ printf '\n[ADHD-A v0.2] ERROR: %s\n' "$*" >&2; exit 1; }
[[ "$(id -u)" == 0 ]] || die 'Run in the Unraid terminal as root.'
command -v docker >/dev/null || die 'Docker is required.'
command -v curl >/dev/null || die 'curl is required.'
[[ -f "$APP/launch.py" && -f "$APP/pyproject.toml" && -f "$APP/adhd_assistant/server.py" ]] || die 'Expected ADHD Assistant v0.1 source is missing.'
[[ -d "$DATA" ]] || die 'Existing /data mount is missing.'
[[ "$(docker inspect -f '{{.State.Running}}' "$CONTAINER" 2>/dev/null)" == true ]] || die 'The existing ADHD Assistant container must be running.'
MOUNTS="$(docker inspect -f '{{range .Mounts}}{{println .Source "->" .Destination}}{{end}}' "$CONTAINER")"
grep -Fq "$APP -> /opt/adhd" <<<"$MOUNTS" || die 'Unexpected code mount. Nothing was changed.'
grep -Fq "$DATA -> /data" <<<"$MOUNTS" || die 'Unexpected database mount. Nothing was changed.'
[[ "$(docker inspect -f '{{.HostConfig.NetworkMode}}' "$CONTAINER")" == host ]] || die 'Expected host network mode.'
if grep -Fq '# ADHD_BRIDGE_V02_START' "$APP/launch.py"; then
  say 'v0.2 bridge overlay is already present. Nothing was changed.'
  docker logs --tail 8 "$CONTAINER" 2>&1 | grep -E 'bridge active|bridge unavailable' || true
  exit 0
fi

[[ "$(grep -Ec '^version[[:space:]]*=[[:space:]]*["\x27]0\.1\.0["\x27]' "$APP/pyproject.toml" || true)" -eq 1 ]] || die 'Installed app does not report v0.1.0; refusing unknown-version patch.'
NETWORK="$(docker network inspect pixelpals_default --format '{{range .IPAM.Config}}{{println .Subnet " " .Gateway}}{{end}}' 2>/dev/null | head -n1)"
read -r CIDR GATEWAY <<<"$NETWORK"
[[ "$CIDR" =~ ^(10\.|172\.|192\.168\.)[0-9.]+/[0-9]+$ && "$GATEWAY" =~ ^[0-9.]+$ ]] || die 'Cannot determine private pixelpals_default subnet and gateway.'
if ss -H -lnt | awk '{print $4}' | grep -Eq ":${PORT}$"; then
  die "Private bridge port $PORT is already in use. No changes made."
fi

# Make sure the unmodified launch.py has a standard __main__ block before editing anything.
if ! grep -Eq '^if __name__[[:space:]]*==[[:space:]]*["\x27]__main__["\x27][[:space:]]*:' "$APP/launch.py"; then
  die 'Unsupported launcher layout; no change was made.'
fi

BACKUP="$BASE/backup-before-v02-$(date +%Y%m%d-%H%M%S)"
mkdir -p "$BACKUP"
cp -p "$APP/launch.py" "$APP/pyproject.toml" "$APP/adhd_assistant/server.py" "$BACKUP/"
# Store launch.py and server.py separately to avoid the same name on rollback.
cp -p "$APP/adhd_assistant/server.py" "$BACKUP/server.py"
say "Original code backed up: $BACKUP"

rollback(){
  say 'Restoring previous v0.1 startup and version files.'
  cp -p "$BACKUP/launch.py" "$APP/launch.py"
  cp -p "$BACKUP/pyproject.toml" "$APP/pyproject.toml"
  cp -p "$BACKUP/server.py" "$APP/adhd_assistant/server.py"
  docker restart "$CONTAINER" >/dev/null || true
  die 'The v0.2 bridge activation did not pass health checks. v0.1 launcher was restored.'
}

cat > "$APP/adhd_assistant/bridge_v02.py" <<'PYTHON_BRIDGE_V02'
"""ADHD Assistant v0.2 beta bridge receiver (opt-in, data-only, Python stdlib).

This keeps inbound Pixel Pals requests in an isolated, owner-review SQLite queue.
It does NOT automatically create tasks, grant tools, or share memories.
"""
from __future__ import annotations

import argparse
import hmac
import ipaddress
import json
import os
from pathlib import Path
import re
import sqlite3
import sys
import threading
from datetime import datetime, timezone
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from urllib.parse import urlsplit

DATA = Path(os.environ.get("ADHD_DATA_DIR", "/data"))
DB = DATA / "bridge-v02.sqlite3"
CONFIG = DATA / "bridge-v02.json"
TOKEN = DATA / "bridge-v02-token"
ID_RE = re.compile(r"[A-Za-z0-9_-]{8,100}\Z")
STARTED = False

def utc_now():
    return datetime.now(timezone.utc).isoformat(timespec="seconds").replace("+00:00", "Z")


def connect():
    connection = sqlite3.connect(str(DB), timeout=10)
    connection.execute("PRAGMA busy_timeout=10000")
    connection.execute("""CREATE TABLE IF NOT EXISTS handoffs (
        id TEXT PRIMARY KEY, kind TEXT NOT NULL, payload TEXT NOT NULL,
        state TEXT NOT NULL CHECK(state IN ('pending','approved','rejected')),
        created_at TEXT NOT NULL, updated_at TEXT NOT NULL)""")
    connection.execute("""CREATE TABLE IF NOT EXISTS bridge_events (
        id INTEGER PRIMARY KEY AUTOINCREMENT, handoff_id TEXT NOT NULL,
        action TEXT NOT NULL, at TEXT NOT NULL)""")
    connection.commit()
    return connection


def validate_message(obj):
    if not isinstance(obj, dict) or set(obj) != {"id", "kind", "payload"}:
        raise ValueError("Only id, kind and payload are accepted")
    ident, kind, payload = obj["id"], obj["kind"], obj["payload"]
    if not isinstance(ident, str) or ID_RE.fullmatch(ident) is None:
        raise ValueError("Invalid handoff id")
    if kind not in ("task", "note"):
        raise ValueError("Only task and note handoffs are supported")
    if not isinstance(payload, dict) or not {"title"} <= set(payload) or set(payload) - {"title", "notes", "due_at", "project"}:
        raise ValueError("Unexpected handoff fields")
    for name, limit in (("title", 240), ("notes", 1500), ("project", 120), ("due_at", 50)):
        value = payload.get(name)
        if value is not None and (not isinstance(value, str) or len(value) > limit or any(ord(c) < 32 for c in value)):
            raise ValueError("Invalid " + name)
    if not isinstance(payload["title"], str) or not payload["title"].strip():
        raise ValueError("Title is required")
    if "due_at" in payload and payload["due_at"]:
        raw = payload["due_at"]
        if not re.match(r"^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}", raw):
            raise ValueError("Invalid due date")
        try:
            datetime.fromisoformat(raw.replace("Z", "+00:00"))
        except ValueError:
            raise ValueError("Invalid due date")
    return ident, kind, json.dumps(payload, ensure_ascii=True, separators=(",", ":"), sort_keys=True)


class Receiver(BaseHTTPRequestHandler):
    server_version = "ADHDBridge/0.2-beta"

    def log_message(self, fmt, *args):
        print("ADHD bridge:", fmt % args, flush=True)

    def respond(self, code, obj):
        raw = json.dumps(obj, separators=(",", ":")).encode()
        self.send_response(code)
        self.send_header("Content-Type", "application/json; charset=utf-8")
        self.send_header("Cache-Control", "no-store")
        self.send_header("X-Content-Type-Options", "nosniff")
        self.send_header("Content-Length", str(len(raw)))
        self.end_headers()
        self.wfile.write(raw)

    def allowed(self):
        try:
            ip = ipaddress.ip_address(self.client_address[0])
            return any(ip in net for net in self.server.allowed_networks)
        except ValueError:
            return False

    def authorize(self):
        if not self.allowed():
            self.respond(403, {"error": "Peer network not allowed"})
            return False
        header = self.headers.get("Authorization", "")
        expected = "Bearer " + self.server.bridge_token
        if not hmac.compare_digest(header.encode(), expected.encode()):
            self.respond(401, {"error": "Bearer token required"})
            return False
        return True

    def do_GET(self):
        if not self.authorize():
            return
        route = urlsplit(self.path)
        if route.query or route.fragment:
            return self.respond(400, {"error": "Invalid request"})
        if route.path == "/bridge/v1/capabilities":
            return self.respond(200, {"protocol": "adhd-bridge/1", "version": "0.2.0-beta", "kinds": ["task", "note"], "approval": "required", "memory_sharing": False})
        prefix = "/bridge/v1/handoffs/"
        if route.path.startswith(prefix):
            ident = route.path[len(prefix):]
            if not ID_RE.fullmatch(ident):
                return self.respond(400, {"error": "Invalid handoff id"})
            with connect() as database:
                row = database.execute("SELECT state, updated_at FROM handoffs WHERE id = ?", (ident,)).fetchone()
            if not row:
                return self.respond(404, {"error": "Unknown handoff"})
            return self.respond(200, {"id": ident, "state": row[0], "updated_at": row[1]})
        return self.respond(404, {"error": "Not found"})

    def do_POST(self):
        if not self.authorize():
            return
        if urlsplit(self.path).path != "/bridge/v1/messages":
            return self.respond(404, {"error": "Not found"})
        if self.headers.get("Content-Type", "").split(";")[0].strip().lower() != "application/json":
            return self.respond(415, {"error": "JSON required"})
        try:
            length = int(self.headers.get("Content-Length", "0"))
        except ValueError:
            length = 0
        if length < 1 or length > 8192:
            return self.respond(413, {"error": "Invalid message size"})
        raw = self.rfile.read(length)
        try:
            message = json.loads(raw.decode("utf-8"))
            ident, kind, payload_json = validate_message(message)
        except (ValueError, UnicodeError, TypeError) as error:
            return self.respond(400, {"error": str(error)[:160]})
        now = utc_now()
        database = connect()
        try:
            database.execute("BEGIN IMMEDIATE")
            existing = database.execute("SELECT kind, payload, state FROM handoffs WHERE id=?", (ident,)).fetchone()
            if existing:
                if existing[0] != kind or existing[1] != payload_json:
                    return self.respond(409, {"error": "Message ID collision"})
                state = existing[2]
                duplicate = True
            else:
                database.execute("INSERT INTO handoffs VALUES (?,?,?,?,?,?)", (ident, kind, payload_json, "pending", now, now))
                database.execute("INSERT INTO bridge_events (handoff_id,action,at) VALUES (?,?,?)", (ident, "received", now))
                state = "pending"
                duplicate = False
            database.commit()
        finally:
            database.close()
        return self.respond(202, {"id": ident, "status": "received_pending_approval" if state == "pending" else state, "duplicate": duplicate})


class BridgeServer(ThreadingHTTPServer):
    daemon_threads = True
    allow_reuse_address = True


def make_server(config, token):
    bind = ipaddress.ip_address(config["bind"])
    if not isinstance(bind, ipaddress.IPv4Address) or not bind.is_private or bind.is_unspecified or bind.is_loopback:
        raise ValueError("Bridge must bind to a specific private IPv4 Docker gateway")
    cidrs = config.get("allow", [])
    if not isinstance(cidrs, list) or not cidrs or len(cidrs) > 8:
        raise ValueError("At least one private network allowlist is required")
    nets = [ipaddress.ip_network(x, strict=False) for x in cidrs]
    if any(not isinstance(x, ipaddress.IPv4Network) or not x.is_private or x.prefixlen < 8 for x in nets):
        raise ValueError("Only private IPv4 CIDRs are allowed")
    port = config["port"]
    if not isinstance(port, int) or not 1024 <= port <= 65535:
        raise ValueError("Invalid bridge port")
    if not isinstance(token, str) or len(token) < 32:
        raise ValueError("Missing secure bridge token")
    server = BridgeServer((str(bind), port), Receiver)
    server.allowed_networks = nets
    server.bridge_token = token
    return server


def start():
    """Called by existing launch.py. Dashboard still works if bridge fails to start."""
    global STARTED
    if STARTED:
        return
    STARTED = True
    if not CONFIG.exists() or not TOKEN.exists():
        print("ADHD v0.2 bridge not configured; dashboard continues.", flush=True)
        return
    try:
        config = json.loads(CONFIG.read_text())
        token = TOKEN.read_text().strip()
        server = make_server(config, token)
        threading.Thread(target=server.serve_forever, name="adhd-bridge-v02", daemon=True).start()
        print(f"ADHD v0.2 bridge active on {config['bind']}:{config['port']} (private Docker network)", flush=True)
    except Exception as error:
        print("ADHD v0.2 bridge unavailable:", str(error), flush=True)


def cli():
    parser = argparse.ArgumentParser(description="ADHD Assistant bridge inbox owner controls")
    parser.add_argument("action", choices=("list", "approve", "reject", "status"))
    parser.add_argument("id", nargs="?")
    arguments = parser.parse_args()
    if arguments.action != "list" and (not arguments.id or not ID_RE.fullmatch(arguments.id)):
        parser.error("A valid handoff id is required")
    with connect() as database:
        if arguments.action == "list":
            for row in database.execute("SELECT id,kind,payload,state,created_at FROM handoffs ORDER BY created_at DESC LIMIT 25"):
                payload = json.loads(row[2])
                print(row[0], row[1], row[3], repr(payload.get("title", "")[:100]))
        elif arguments.action == "status":
            row = database.execute("SELECT id,state,updated_at FROM handoffs WHERE id=?", (arguments.id,)).fetchone()
            if not row:
                print("Unknown handoff", file=sys.stderr)
                sys.exit(1)
            print(*row)
        else:
            now = utc_now()
            updated = database.execute("UPDATE handoffs SET state=?,updated_at=? WHERE id=? AND state='pending'", ("approved" if arguments.action == "approve" else "rejected", now, arguments.id))
            if updated.rowcount != 1:
                print("Handoff not found or already reviewed", file=sys.stderr)
                sys.exit(1)
            database.execute("INSERT INTO bridge_events (handoff_id,action,at) VALUES (?,?,?)", (arguments.id, arguments.action, now))
            database.commit()
            print("Handoff", arguments.id, arguments.action + "d")


if __name__ == "__main__":
    cli()
PYTHON_BRIDGE_V02
chmod 644 "$APP/adhd_assistant/bridge_v02.py"

if [[ ! -f "$DATA/bridge-v02-token" ]]; then
  (umask 077; head -c 48 /dev/urandom | base64 | tr -d '\n' > "$DATA/bridge-v02-token"; printf '\n' >> "$DATA/bridge-v02-token")
  chown --reference="$DATA" "$DATA/bridge-v02-token" || true
fi
cat > "$DATA/bridge-v02.json" <<CONFIG_JSON
{"bind":"$GATEWAY","port":$PORT,"allow":["$CIDR"]}
CONFIG_JSON
chmod 600 "$DATA/bridge-v02.json"
chown --reference="$DATA" "$DATA/bridge-v02.json" || true

# Insert launch hook directly before the existing __main__ block; never rewrite the app's original logic.
awk '
  /^if __name__[[:space:]]*==[[:space:]]*["\047]__main__["\047][[:space:]]*:/ && !done {
    print "# ADHD_BRIDGE_V02_START"
    print "from adhd_assistant.bridge_v02 import start as _adhd_bridge_v02_start"
    print "_adhd_bridge_v02_start()"
    print "# ADHD_BRIDGE_V02_END"
    print ""
    done=1
  }
  { print }
  END { if (!done) exit 45 }
' "$BACKUP/launch.py" > "$APP/launch.py.tmp" || rollback
chmod --reference="$BACKUP/launch.py" "$APP/launch.py.tmp"
mv -f "$APP/launch.py.tmp" "$APP/launch.py"
sed -i -E 's/^version[[:space:]]*=[[:space:]]*"0\.1\.0"/version = "0.2.0-beta"/' "$APP/pyproject.toml"
sed -i 's@ADHDAssistant/0\.1@ADHDAssistant/0.2@g; s@"version":"0\.1\.0"@"version":"0.2.0-beta"@g' "$APP/adhd_assistant/server.py"

if ! docker exec "$CONTAINER" python -c 'from pathlib import Path; compile(Path("/opt/adhd/launch.py").read_text(),"launch.py","exec"); compile(Path("/opt/adhd/adhd_assistant/bridge_v02.py").read_text(),"bridge_v02.py","exec")'; then
  rollback
fi

say "Restarting ONLY $CONTAINER with the new private bridge."
if ! docker restart "$CONTAINER" >/dev/null; then rollback; fi

SUCCESS=0
for _ in $(seq 1 35); do
  APP_CODE="$(curl --noproxy '*' -sS --max-time 2 -o /dev/null -w '%{http_code}' http://127.0.0.1:8765/health 2>/dev/null || true)"
  BRIDGE_CODE="$(curl --noproxy '*' -sS --max-time 2 -o /dev/null -w '%{http_code}' "http://$GATEWAY:$PORT/bridge/v1/capabilities" 2>/dev/null || true)"
  if [[ "$APP_CODE" == 200 && "$BRIDGE_CODE" == 401 ]]; then SUCCESS=1; break; fi
  sleep 1
done
if [[ "$SUCCESS" != 1 ]]; then
  say 'Dashboard or bridge failed verification.'
  docker logs --tail 35 "$CONTAINER" 2>&1 | sed -E 's/(Bearer |token=)[A-Za-z0-9_+\/=.-]+/\1[redacted]/g' || true
  rollback
fi

say 'SUCCESS: ADHD Assistant v0.2 bridge-enabled overlay is running.'
printf 'Dashboard: 127.0.0.1:8765 (existing Caddy proxy preserved)\n'
printf 'Bridge: %s:%s (private Docker gateway, token required)\n' "$GATEWAY" "$PORT"
printf 'Review inbox: docker exec adhd-assistant python -m adhd_assistant.bridge_v02 list\n'
printf 'Pixel Pals has NOT been reconfigured; no messages have been sent.\n'
printf 'No database files or production Pixel Pals containers were deleted or replaced.\n'
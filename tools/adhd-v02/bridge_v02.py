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
    # Within a private, un-published Docker Compose service, wildcard binding
    # is required because Docker assigns the container IP dynamically.
    # Keep explicit scoped authorization and a strict private peer allowlist.
    scope = config.get("scope")
    if not isinstance(bind, ipaddress.IPv4Address):
        raise ValueError("Bridge requires IPv4")
    if bind.is_unspecified:
        if scope != "compose_private":
            raise ValueError("Wildcard binding requires private Compose mode")
    elif not bind.is_private or bind.is_loopback or scope not in (None, "host_gateway"):
        raise ValueError("Bridge must bind to an approved private Docker interface")
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
    parser.add_argument("action", choices=("list", "approve", "reject", "status", "serve"))
    parser.add_argument("id", nargs="?")
    arguments = parser.parse_args()
    if arguments.action == "serve":
        config = json.loads(CONFIG.read_text())
        token = TOKEN.read_text().strip()
        server = make_server(config, token)
        print(f"ADHD v0.2 bridge active on {config['bind']}:{config['port']} (private Docker network)", flush=True)
        try:
            server.serve_forever(poll_interval=0.5)
        finally:
            server.server_close()
        return
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
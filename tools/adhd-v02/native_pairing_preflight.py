#!/usr/bin/env python3
"""Read-only native ADHD handoff pairing readiness check.

No token reads, peer URLs, task content, notes, private memories, or database
modifications. This is a diagnostic only: it never configures either app.
"""
from __future__ import annotations

import argparse
import ast
from contextlib import closing
import json
from pathlib import Path
import sqlite3
import sys
from urllib.parse import quote

NATIVE_METHODS = (
    "connect", "backup", "setting", "create_handoff", "approve_handoff",
    "add_peer", "update_peer",
)
REQUIRED_COLUMNS = {
    "handoffs": {"id", "direction", "peer_id", "kind", "payload", "state"},
    "tasks": {"id", "title", "notes", "status", "source"},
    "peers": {"id", "enabled"},
    "settings": {"key", "value"},
}


def _read_only_db(path: Path) -> sqlite3.Connection:
    if not path.is_file():
        raise ValueError("Native ADHD task database not found")
    # Do not create a missing DB. Never write settings or peer records.
    address = "file:" + quote(str(path.resolve()), safe="/") + "?mode=ro"
    db = sqlite3.connect(address, uri=True, timeout=5)
    db.execute("PRAGMA query_only=ON")
    return db


def _source_features(source_root: Path) -> dict[str, bool]:
    file = source_root / "adhd_assistant" / "database.py"
    if not file.is_file():
        raise ValueError("Native ADHD Store source is missing")
    # Parse only: do not import or execute installed application code.
    tree = ast.parse(file.read_text(encoding="utf-8"))
    store = next((node for node in tree.body
                  if isinstance(node, ast.ClassDef) and node.name == "Store"), None)
    if store is None:
        raise ValueError("Native ADHD Store class is unavailable")
    methods = {node.name for node in store.body
               if isinstance(node, (ast.FunctionDef, ast.AsyncFunctionDef))}
    return {name: name in methods for name in NATIVE_METHODS}


def inspect_native(source_root: Path, native_db: Path) -> dict[str, object]:
    features = _source_features(source_root)
    with closing(_read_only_db(native_db)) as db:
        tables = {row[0] for row in db.execute(
            "SELECT name FROM sqlite_master WHERE type='table'"
        )}
        schema_ok = all(name in tables and columns <= {
            row[1] for row in db.execute("PRAGMA table_info(" + name + ")")
        } for name, columns in REQUIRED_COLUMNS.items())
        if "settings" in tables and {"key", "value"} <= {
            row[1] for row in db.execute("PRAGMA table_info(settings)")
        }:
            row = db.execute("SELECT value FROM settings WHERE key='bridge_enabled'").fetchone()
            native_enabled = bool(row and row[0] == "on")
        else:
            native_enabled = False
        if "peers" in tables and {"id", "enabled"} <= {
            row[1] for row in db.execute("PRAGMA table_info(peers)")
        }:
            peer_count = db.execute("SELECT COUNT(*) FROM peers WHERE enabled=1").fetchone()[0]
        else:
            peer_count = 0
    implementation_available = schema_ok and all(features.values())
    ready_for_staging = implementation_available and native_enabled and peer_count >= 1
    blockers = []
    if not implementation_available:
        blockers.append("native_schema_or_store_methods_unverified")
    if not native_enabled:
        blockers.append("native_bridge_disabled")
    if peer_count < 1:
        blockers.append("no_enabled_native_peer")
    return {
        "format": "adhd-native-handoff-preflight",
        "version": 1,
        "read_only": True,
        "native_schema_matches": schema_ok,
        "native_store_methods_present": features,
        "native_bridge_enabled": native_enabled,
        "enabled_native_peer_count": peer_count,
        "ready_for_staging": ready_for_staging,
        "live_task_creation_authorized": False,
        "blockers": blockers,
    }


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description="Read-only ADHD native bridge setup preflight")
    parser.add_argument("--source-root", type=Path, required=True,
                        help="Directory containing adhd_assistant/database.py")
    parser.add_argument("--database", type=Path, required=True,
                        help="Existing ADHD Assistant SQLite database")
    args = parser.parse_args(argv)
    try:
        result = inspect_native(args.source_root, args.database)
    except (OSError, ValueError, SyntaxError, sqlite3.Error, UnicodeError):
        # No paths or SQL error contents may inadvertently reveal private data.
        print("Native pairing preflight could not complete safely", file=sys.stderr)
        return 1
    print(json.dumps(result, sort_keys=True))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())

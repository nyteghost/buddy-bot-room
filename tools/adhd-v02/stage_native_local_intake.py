#!/usr/bin/env python3
"""Offline rehearsal using the INSTALLED ADHD Assistant Store class, not mocks.

Run ONLY inside an isolated disposable container with:
  * network disabled
  * installed ADHD source mounted read-only
  * NO /data mount or access to the user's persisted ADHD SQLite DB
  * writable ephemeral /tmp mount
  * ADHD_STAGING_ONLY=1

This verifies the real native Store schema and approval path without changing
installed task, peer or memory data. Never calls native add_peer or set_setting.
"""
from __future__ import annotations

import json
import os
from pathlib import Path
import sqlite3
import sys
import tempfile

from native_local_intake import CONFIRM, LOCAL_SOURCE, link_local_task, preview_local_task


def _check(condition: bool, error: str) -> None:
    if not condition:
        raise RuntimeError(error)


def run_rehearsal(StoreClass: type, *, scratch: Path) -> dict[str, object]:
    """All persistence lives inside a disposable directory supplied by caller."""
    scratch.mkdir(parents=True, exist_ok=True)
    native_data = scratch / "native"
    sidecar_data = scratch / "bridge"
    native_data.mkdir(mode=0o700)
    sidecar_data.mkdir(mode=0o700)

    native = StoreClass(native_data)
    _check(native.setting("bridge_enabled", "off") != "on",
           "Native Store unexpectedly enables network bridge")
    with native.connect() as db:
        _check(db.execute("SELECT COUNT(*) FROM tasks").fetchone()[0] == 0,
               "Native task fixture was not empty")
        _check(db.execute("SELECT COUNT(*) FROM peers").fetchone()[0] == 0,
               "Native Store fixture unexpectedly has network peers")

    bridge_db = sidecar_data / "bridge-v02.sqlite3"
    with sqlite3.connect(bridge_db) as db:
        db.execute("""CREATE TABLE handoffs(
            id TEXT PRIMARY KEY,kind TEXT,payload TEXT,state TEXT,
            created_at TEXT,updated_at TEXT)""")
        db.execute("""CREATE TABLE bridge_events(
            id INTEGER PRIMARY KEY,handoff_id TEXT,action TEXT,at TEXT)""")
        # Pure synthetic test content: never read a user handoff or task.
        db.execute("INSERT INTO handoffs VALUES(?,?,?,?,?,?)", (
            "local-stage-0001", "task",
            json.dumps({"title": "Staging test only", "notes": "Nonprivate fixture"}),
            "approved", "2026-11-06T12:00:00Z", "2026-11-06T12:01:00Z",
        ))
        db.execute("INSERT INTO bridge_events(handoff_id,action,at) VALUES(?,?,?)", (
            "local-stage-0001", "approve", "2026-11-06T12:01:00Z",
        ))

    preview = preview_local_task(bridge_db, native, handoff_id="local-stage-0001")
    _check(preview["preview_only"] and preview["native_state"] == "unlinked",
           "Preflight did not leave a task unlinked")
    result = link_local_task(bridge_db, native,
                             handoff_id="local-stage-0001", confirm=CONFIRM)
    _check(result["outcome"] == "linked" and result["backup_created"],
           "Native Store did not create and back up test handoff")
    with native.connect() as db:
        row = db.execute(
            "SELECT id,status,source FROM tasks WHERE id=?", ("handoff-local-stage-0001",)
        ).fetchone()
        _check(row is not None and tuple(row) == (
            "handoff-local-stage-0001", "open", "bridge:" + LOCAL_SOURCE,
        ), "Native task fields differ from approved handoff contract")
        _check(db.execute("SELECT COUNT(*) FROM tasks").fetchone()[0] == 1,
               "Native Store generated an unexpected number of tasks")
        _check(db.execute("SELECT COUNT(*) FROM peers").fetchone()[0] == 0,
               "A native network peer was added")
        audit_rows = db.execute(
            "SELECT COUNT(*) FROM audit WHERE action=?", ("handoff.approved",)
        ).fetchone()[0]
        _check(audit_rows >= 1, "Native handoff approval audit missing")
    again = link_local_task(bridge_db, native,
                            handoff_id="local-stage-0001", confirm=CONFIRM)
    _check(again["outcome"] == "already-linked" and not again["backup_created"],
           "Repeated import was not idempotent")
    with native.connect() as db:
        _check(db.execute("SELECT COUNT(*) FROM tasks").fetchone()[0] == 1,
               "Repeated import created a duplicate task")
    snapshots = list((native_data / "backups").glob("adhd-*.sqlite3"))
    _check(len(snapshots) >= 1, "Native Store backup file missing")
    _check(native.setting("bridge_enabled", "off") != "on",
           "Native bridge setting unexpectedly changed")
    return {
        "result": "PASS",
        "mode": "offline-disposable-native-store",
        "real_app_source_tested": True,
        "user_database_accessed": False,
        "network_bridge_enabled": False,
        "native_peer_created": False,
        "native_audit_verified": True,
        "duplicate_protection_verified": True,
        "backup_verified": True,
        "live_deployment_authorized": False,
    }


def main() -> int:
    if os.environ.get("ADHD_STAGING_ONLY") != "1":
        print("REFUSED: ADHD_STAGING_ONLY=1 is required", file=sys.stderr)
        return 2
    if Path("/data/adhd.sqlite3").exists():
        print("REFUSED: do not mount the installed ADHD task database", file=sys.stderr)
        return 2
    try:
        from adhd_assistant.database import Store
        with tempfile.TemporaryDirectory(prefix="adhd-native-staging-", dir="/tmp") as root:
            result = run_rehearsal(Store, scratch=Path(root))
        print(json.dumps(result, sort_keys=True))
        return 0
    except Exception as error:
        # Do not print private values, filesystem paths, or task payloads.
        print("Native ADHD Store staging rehearsal FAILED: " + type(error).__name__,
              file=sys.stderr)
        return 1


if __name__ == "__main__":
    raise SystemExit(main())

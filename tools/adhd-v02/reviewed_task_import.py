#!/usr/bin/env python3
"""Conservative, opt-in ADHD Assistant task intake, for fixture-only validation.

The installed application may have additional task semantics; this module is NOT
installed on Unraid until its task API and status values have been reviewed.

Source records are exported only after *receiver* approval. Existing tasks are
never modified. The optional apply mode requires an explicit confirmation,
reviewed task status, backup directory, and an exclusive SQLite transaction.
"""
from __future__ import annotations

import argparse
from contextlib import closing
from datetime import datetime, timezone
import json
import os
from pathlib import Path
import re
import sqlite3
import sys
import tempfile
from urllib.parse import quote
from uuid import uuid4

from approved_task_export import export_approved_tasks

REQUIRED_TASK_COLUMNS = {
    "id", "title", "notes", "due_at", "status",
    "project_id", "source", "created_at", "updated_at",
}
SOURCE_PREFIX = "pixel-pals:"
CONFIRM_PHRASE = "IMPORT_APPROVED_TASKS"
STATUS_RE = re.compile(r"[a-z][a-z0-9_-]{0,39}\Z")


def _connect(database: Path, *, readonly: bool) -> sqlite3.Connection:
    if not database.is_file():
        raise ValueError("ADHD Assistant tasks database not found")
    mode = "ro" if readonly else "rw"   # NEVER create a missing task database.
    uri = "file:" + quote(str(database.resolve()), safe="/") + "?mode=" + mode
    db = sqlite3.connect(uri, uri=True, timeout=10, isolation_level=None)
    db.execute("PRAGMA busy_timeout=10000")
    if readonly:
        db.execute("PRAGMA query_only=ON")
    return db


def _verify_schema(db: sqlite3.Connection) -> None:
    columns = {row[1]: row for row in db.execute("PRAGMA table_info(tasks)")}
    if not REQUIRED_TASK_COLUMNS <= columns.keys() or columns["id"][5] != 1:
        raise ValueError("ADHD task schema differs from the verified v0.1 columns")
    for field in REQUIRED_TASK_COLUMNS:
        if columns[field][2].upper() != "TEXT":
            raise ValueError("Unexpected ADHD task column type: " + field)
    # Confirm the actual v0.1 NOT NULL + default contract observed on Unraid.
    for field in ("title", "notes", "status", "source", "created_at", "updated_at"):
        if columns[field][3] != 1:
            raise ValueError("Unexpected nullable ADHD task column: " + field)
    defaults = {"notes": "''", "status": "'open'", "source": "'manual'"}
    for field, expected in defaults.items():
        if columns[field][4] != expected:
            raise ValueError("Unexpected ADHD task default for " + field)
    triggers = db.execute("SELECT COUNT(*) FROM sqlite_master WHERE type='trigger' AND tbl_name='tasks'").fetchone()[0]
    if triggers:
        raise ValueError("ADHD task triggers require application-level review")


def _classify(db: sqlite3.Connection, tasks: list[dict[str, object]]) -> dict[str, object]:
    ready: list[dict[str, object]] = []
    existing = 0
    project_holds = 0
    ids: set[str] = set()
    for task in tasks:
        source = task.get("source_id")
        if not isinstance(source, str) or not source.startswith(SOURCE_PREFIX):
            raise ValueError("Invalid approved handoff source")
        if source in ids:
            raise ValueError("Duplicate source in approved handoff snapshot")
        ids.add(source)
        n = db.execute("SELECT COUNT(*) FROM tasks WHERE source = ?", (source,)).fetchone()[0]
        if n > 1:
            raise ValueError("Multiple destination tasks share a source identifier")
        if n:
            existing += 1
        elif task.get("project"):
            # Project names must be resolved to real foreign key IDs by ADHD-A.
            project_holds += 1
        else:
            ready.append(task)
    return {"ready": ready, "existing": existing, "project_holds": project_holds,
            "approved": len(tasks)}


def preview(bridge_db: Path, tasks_db: Path) -> dict[str, object]:
    tasks = export_approved_tasks(bridge_db)["tasks"]
    with closing(_connect(tasks_db, readonly=True)) as db:
        _verify_schema(db)
        plan = _classify(db, tasks)
    return _summary(plan, applied=0, backup_created=False)


def _summary(plan: dict[str, object], *, applied: int, backup_created: bool) -> dict[str, object]:
    return {
        "format": "adhd-assistant-reviewed-task-import", "version": 1,
        "approved": plan["approved"], "ready": len(plan["ready"]),
        "already_present": plan["existing"],
        "requires_project_mapping": plan["project_holds"],
        "inserted": applied, "backup_created": backup_created,
        "private_task_content_logged": False,
    }


def _backup(db: sqlite3.Connection, destination: Path) -> Path:
    if not destination.is_dir() or destination.is_symlink():
        raise ValueError("Backup directory must exist and not be a symlink")
    if destination.stat().st_mode & 0o077:
        raise ValueError("Backup directory must be private (mode 0700)")
    fd, filename = tempfile.mkstemp(prefix="adhd-tasks-before-import-", suffix=".sqlite3", dir=destination)
    os.close(fd)
    path = Path(filename)
    try:
        with sqlite3.connect(path) as saved:
            db.backup(saved)
        return path
    except Exception:
        path.unlink(missing_ok=True)
        raise


def apply_explicitly_approved(
    bridge_db: Path, tasks_db: Path, *, task_status: str,
    confirm: str, backup_dir: Path,
) -> dict[str, object]:
    """Create task rows only with an explicit operator choice and verified status.

    A backup is made before any task write. Project handoffs are held for human
    mapping. Duplicate detection is done again after BEGIN IMMEDIATE, preventing
    two copies of this importer from racing one another.
    """
    if confirm != CONFIRM_PHRASE:
        raise ValueError("Explicit import confirmation missing")
    # The verified v0.1 table declares DEFAULT 'open' even when tasks is empty.
    # Do not assume any other runtime status semantics based on existing rows.
    if task_status != "open":
        raise ValueError("Only the verified ADHD task default status 'open' is supported")
    tasks = export_approved_tasks(bridge_db)["tasks"]
    with closing(_connect(tasks_db, readonly=False)) as db:
        _verify_schema(db)
        # The table's NOT NULL DEFAULT 'open' is verified by _verify_schema;
        # do not require an existing row, because the live tasks table is empty.
        # Pre-classification is non-mutating and catches duplicate sources early.
        initial = _classify(db, tasks)
        if not initial["ready"]:
            return _summary(initial, applied=0, backup_created=False)
        _backup(db, backup_dir)
        inserted = 0
        db.execute("BEGIN IMMEDIATE")
        try:
            _verify_schema(db)
            # A source may have been imported between preflight and transaction.
            plan = _classify(db, tasks)
            timestamp = datetime.now(timezone.utc).isoformat(timespec="seconds").replace("+00:00", "Z")
            for item in plan["ready"]:
                db.execute(
                    """INSERT INTO tasks
                       (id,title,notes,due_at,status,project_id,source,created_at,updated_at)
                       VALUES(?,?,?,?,?,NULL,?,?,?)""",
                    (
                        uuid4().hex,
                        item["title"], item["notes"] if item["notes"] is not None else "", item["due_at"],
                        task_status, item["source_id"], timestamp, timestamp,
                    ),
                )
                inserted += 1
            db.execute("COMMIT")
        except Exception:
            db.execute("ROLLBACK")
            raise
        return _summary(plan, applied=inserted, backup_created=True)


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description="ADHD task import prototype: dry-run by default")
    parser.add_argument("--bridge-data-dir", type=Path, default=Path(os.environ.get("ADHD_DATA_DIR", "/data")))
    parser.add_argument("--adhd-data-dir", type=Path, default=Path(os.environ.get("ADHD_DATA_DIR", "/data")))
    parser.add_argument("--apply", action="store_true", help="Experimental: requires backup, confirmation, and verified default status 'open'")
    parser.add_argument("--status", default="")
    parser.add_argument("--confirm", default="")
    parser.add_argument("--backup-dir", type=Path)
    args = parser.parse_args(argv)
    try:
        bridge_db = args.bridge_data_dir / "bridge-v02.sqlite3"
        tasks_db = args.adhd_data_dir / "adhd.sqlite3"
        if args.apply:
            # Raw SQL bypasses ADHD-A's native handoff and audit workflow.
            # Keep this legacy writer fixture-test-only. Never permit CLI use
            # against real Unraid data; integration must use native Store APIs.
            raise ValueError("Direct SQLite task creation is disabled; use native handoff review")
        result = preview(bridge_db, tasks_db)
        print(json.dumps(result, sort_keys=True))
        return 0
    except (OSError, sqlite3.Error, ValueError, TypeError) as error:
        print("ADHD task import unavailable: " + str(error), file=sys.stderr)
        return 1


if __name__ == "__main__":
    raise SystemExit(main())

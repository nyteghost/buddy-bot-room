#!/usr/bin/env python3
"""Export explicitly approved bridge tasks as read-only, task-ready JSON.

This is a staging contract for a future ADHD Assistant importer, not an importer.
It never writes to any database, creates a task, or changes approval state.
"""
from __future__ import annotations

import argparse
from contextlib import closing
from datetime import datetime
import json
import os
from pathlib import Path
import re
import sqlite3
import sys
from urllib.parse import quote

ID = re.compile(r"[A-Za-z0-9_-]{8,100}\Z")
MAX_EXPORT = 500
FORMAT = "adhd-assistant-approved-task-intake"


def _safe_text(value: object, name: str, limit: int) -> str | None:
    if value is None:
        return None
    if not isinstance(value, str) or len(value) > limit or any(ord(c) < 32 for c in value):
        raise ValueError(f"Invalid {name} in approved bridge task")
    return value


def _normalize_task(ident: object, raw: object, approved_at: object) -> dict[str, object]:
    if not isinstance(ident, str) or not ID.fullmatch(ident):
        raise ValueError("Invalid approved bridge task identifier")
    if not isinstance(approved_at, str) or len(approved_at) > 40:
        raise ValueError("Invalid bridge approval timestamp")
    try:
        datetime.fromisoformat(approved_at.replace("Z", "+00:00"))
    except ValueError as error:
        raise ValueError("Invalid bridge approval timestamp") from error
    try:
        payload: object = json.loads(raw) if isinstance(raw, str) else None
    except (ValueError, TypeError) as error:
        raise ValueError("Invalid stored task payload") from error
    if not isinstance(payload, dict) or set(payload) - {"title", "notes", "due_at", "project"}:
        raise ValueError("Unexpected fields in approved bridge task")
    title = _safe_text(payload.get("title"), "title", 240)
    if not isinstance(title, str) or not title.strip():
        raise ValueError("Approved bridge task needs a title")
    notes = _safe_text(payload.get("notes"), "notes", 1500)
    due = _safe_text(payload.get("due_at"), "due_at", 50)
    project = _safe_text(payload.get("project"), "project", 120)
    if due:
        if not re.match(r"^\d{4}-\d\d-\d\dT\d\d:\d\d", due):
            raise ValueError("Invalid approved task due date")
        try:
            datetime.fromisoformat(due.replace("Z", "+00:00"))
        except ValueError as error:
            raise ValueError("Invalid approved task due date") from error
    return {
        "source_id": "pixel-pals:" + ident,
        "handoff_id": ident,
        "approved_at": approved_at,
        "title": title.strip(),
        "notes": notes,
        "due_at": due,
        "project": project,
    }


def export_approved_tasks(database: Path) -> dict[str, object]:
    """Return an idempotent import snapshot; never open SQLite in write mode."""
    if not database.is_file():
        raise FileNotFoundError("Bridge database not found; no task export was created")
    # SQLite mode=ro prevents accidental schema initialization or state mutations.
    uri = "file:" + quote(str(database.resolve()), safe="/") + "?mode=ro"
    try:
        with closing(sqlite3.connect(uri, uri=True, timeout=5)) as connection:
            connection.execute("PRAGMA query_only=ON")
            rows = connection.execute(
                """SELECT h.id, h.payload,
                   (SELECT e.at FROM bridge_events e
                     WHERE e.handoff_id = h.id AND e.action = 'approve'
                     ORDER BY e.id LIMIT 1) AS approved_at
                   FROM handoffs h
                   WHERE h.kind = 'task' AND h.state = 'approved'
                     AND EXISTS(SELECT 1 FROM bridge_events e
                                WHERE e.handoff_id = h.id AND e.action = 'approve')
                   ORDER BY h.created_at, h.id LIMIT ?""",
                (MAX_EXPORT + 1,),
            ).fetchall()
    except sqlite3.DatabaseError as error:
        raise ValueError("Cannot read approved handoffs from bridge database") from error
    if len(rows) > MAX_EXPORT:
        raise ValueError("More than 500 approved tasks; refusing a truncated export")
    tasks = [_normalize_task(*row) for row in rows]
    return {"format": FORMAT, "version": 1, "source": "pixel-pals-bridge", "tasks": tasks}


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description="Read-only approved task snapshot for future ADHD Assistant import")
    parser.add_argument("--data-dir", type=Path, default=Path(os.environ.get("ADHD_DATA_DIR", "/data")))
    arguments = parser.parse_args(argv)
    try:
        print(json.dumps(export_approved_tasks(arguments.data_dir / "bridge-v02.sqlite3"), sort_keys=True, ensure_ascii=True))
    except (FileNotFoundError, ValueError, OSError) as error:
        print(f"Approved task export failed: {error}", file=sys.stderr)
        return 1
    return 0


if __name__ == "__main__":
    raise SystemExit(main())

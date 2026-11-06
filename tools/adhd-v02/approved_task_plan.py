#!/usr/bin/env python3
"""Read-only preview of approved Pixel Pals handoffs against ADHD-A v0.1 tasks.

Does not create tasks, change existing task rows, or apply schema migrations.
Prints aggregate counts only; no private task titles, notes, or IDs are logged.
"""
from __future__ import annotations

import argparse
from collections import Counter
from contextlib import closing
import json
import os
from pathlib import Path
import sqlite3
import sys
from urllib.parse import quote

from approved_task_export import export_approved_tasks

REQUIRED_TASK_COLUMNS = frozenset({
    "id", "title", "notes", "due_at", "status",
    "project_id", "source", "created_at", "updated_at",
})


def _read_only_connection(database: Path) -> sqlite3.Connection:
    if not database.is_file():
        raise FileNotFoundError("ADHD Assistant task database does not exist")
    # Existing tasks must never be initialized or changed by a preview.
    uri = "file:" + quote(str(database.resolve()), safe="/") + "?mode=ro"
    connection = sqlite3.connect(uri, uri=True, timeout=5)
    connection.execute("PRAGMA query_only=ON")
    return connection


def preview_approved_tasks(bridge_db: Path, adhd_db: Path) -> dict[str, object]:
    """Read approved handoffs and classify import candidates without any writes."""
    approved = export_approved_tasks(bridge_db)["tasks"]
    if not isinstance(approved, list):
        raise ValueError("Invalid approved task snapshot")
    with closing(_read_only_connection(adhd_db)) as database:
        columns = {row[1]: row for row in database.execute("PRAGMA table_info(tasks)")}
        if not REQUIRED_TASK_COLUMNS <= columns.keys() or columns["id"][5] != 1:
            raise ValueError("Installed ADHD Assistant task schema differs from verified v0.1 layout")
        # Only read the source column; never load existing private task content.
        sources = Counter(
            row[0] for row in database.execute(
                "SELECT source FROM tasks WHERE source LIKE 'pixel-pals:%'"
            ) if isinstance(row[0], str) and row[0].startswith("pixel-pals:")
        )
    ready = 0
    existing = 0
    needs_project_review = 0
    for item in approved:
        if not isinstance(item, dict) or not isinstance(item.get("source_id"), str):
            raise ValueError("Invalid approved task identity")
        source_id = item["source_id"]
        if not source_id.startswith("pixel-pals:"):
            raise ValueError("Unexpected task source namespace")
        if sources[source_id] > 1:
            raise ValueError("Multiple existing ADHD tasks use the same source identifier")
        if sources[source_id] == 1:
            existing += 1
        elif item.get("project"):
            # A project *name* is not a safe foreign-key project_id.
            needs_project_review += 1
        else:
            ready += 1
    return {
        "format": "adhd-assistant-task-intake-preview",
        "version": 1,
        "preview_only": True,
        "database_modified": False,
        "approved_handoffs": len(approved),
        "ready_for_explicit_import": ready,
        "already_present": existing,
        "needs_project_mapping": needs_project_review,
        "automatic_creation_enabled": False,
    }


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description="Preview ADHD task intake; no data changes")
    parser.add_argument(
        "--bridge-data-dir", type=Path,
        default=Path(os.environ.get("ADHD_DATA_DIR", "/data")),
    )
    parser.add_argument(
        "--adhd-data-dir", type=Path,
        default=Path(os.environ.get("ADHD_DATA_DIR", "/data")),
    )
    args = parser.parse_args(argv)
    try:
        plan = preview_approved_tasks(
            args.bridge_data_dir / "bridge-v02.sqlite3",
            args.adhd_data_dir / "adhd.sqlite3",
        )
        print(json.dumps(plan, sort_keys=True))
        return 0
    except (OSError, sqlite3.Error, ValueError) as error:
        print(f"Approved-task preview unavailable: {error}", file=sys.stderr)
        return 1


if __name__ == "__main__":
    raise SystemExit(main())

#!/usr/bin/env python3
"""Native ADHD-A review inbox service, designed for its EXISTING local-only UI.

Not an HTTP server and does not bypass the installed application's _local()
authorization. UI route wiring must use the dashboard's own auth, plus
same-origin CSRF protections, before a live installation is allowed.

Only authenticated owner-initiated actions may call review()/import_task().
There are NO timers, automatic imports, peer registrations or memory sharing.
"""
from __future__ import annotations

from contextlib import closing
from datetime import datetime, timezone
import json
from pathlib import Path
import re
import sqlite3
from typing import Any
from urllib.parse import quote

from native_local_intake import CONFIRM as IMPORT_CONFIRM
from native_local_intake import LOCAL_SOURCE, link_local_task, preview_local_task

HANDOFF_ID = re.compile(r"[A-Za-z0-9_-]{8,100}\Z")
MAX_PAGE_SIZE = 50
APPROVE_CONFIRM = "REVIEW_PIXEL_PALS_HANDOFF"
SUPPORTED_KINDS = {"task", "note"}


def _db(bridge_db: Path, *, read_only: bool) -> sqlite3.Connection:
    if not bridge_db.is_file() or bridge_db.is_symlink():
        raise ValueError("Existing bridge inbox database is unavailable")
    mode = "ro" if read_only else "rw"
    uri = "file:" + quote(str(bridge_db.resolve()), safe="/") + "?mode=" + mode
    connection = sqlite3.connect(uri, timeout=10, uri=True, isolation_level=None)
    connection.row_factory = sqlite3.Row
    connection.execute("PRAGMA busy_timeout=10000")
    if read_only:
        connection.execute("PRAGMA query_only=ON")
    return connection


def _check_schema(db: sqlite3.Connection) -> None:
    required = {
        "handoffs": {"id", "kind", "payload", "state", "created_at", "updated_at"},
        "bridge_events": {"id", "handoff_id", "action", "at"},
    }
    for table, cols in required.items():
        actual = {row[1] for row in db.execute("PRAGMA table_info(" + table + ")")}
        if not cols <= actual:
            raise ValueError("Unsupported bridge inbox schema")


def _normalize(row: sqlite3.Row) -> dict[str, object]:
    try:
        payload = json.loads(row["payload"])
    except (ValueError, TypeError) as ex:
        raise ValueError("Invalid stored handoff payload") from ex
    if not isinstance(payload, dict) or not set(payload) <= {"title", "notes", "due_at", "project"}:
        raise ValueError("Invalid stored handoff fields")
    title = payload.get("title")
    if not isinstance(title, str) or len(title) > 240 or not title.strip():
        raise ValueError("Invalid stored handoff title")
    notes = payload.get("notes", "")
    if not isinstance(notes, str) or len(notes) > 1500:
        raise ValueError("Invalid stored handoff notes")
    kind, state = row["kind"], row["state"]
    if kind not in SUPPORTED_KINDS or state not in ("pending", "approved", "rejected"):
        raise ValueError("Unsupported handoff kind/state")
    return {
        "id": row["id"], "kind": kind, "state": state,
        "title": title, "notes": notes,
        "project": payload.get("project") or None,
        "due_at": payload.get("due_at") or None,
        "created_at": row["created_at"],
    }


def list_inbox(bridge_db: Path, *, native_store: Any = None,
               limit: int = MAX_PAGE_SIZE) -> dict[str, object]:
    """Returns user-visible preview data for an already AUTHORIZED local UI.

    IMPORTANT: title and notes are private; never print or log this result.
    """
    if not isinstance(limit, int) or not 1 <= limit <= MAX_PAGE_SIZE:
        raise ValueError("Invalid page size")
    with closing(_db(bridge_db, read_only=True)) as db:
        _check_schema(db)
        rows = db.execute(
            """SELECT id,kind,payload,state,created_at FROM handoffs
               ORDER BY created_at DESC, id DESC LIMIT ?""", (limit,)
        ).fetchall()
        items = [_normalize(row) for row in rows]
    # Only the installed Store may verify whether a reviewed handoff has
    # become a real ADHD task. Never read titles, notes or memory from its DB.
    approved_tasks = [item for item in items
                      if item["state"] == "approved" and item["kind"] == "task"]
    for item in approved_tasks:
        item["native_state"] = "unverified"
    if approved_tasks and native_store is not None:
        keys = ["handoff-" + item["id"] for item in approved_tasks]
        placeholders = ",".join("?" for _ in keys)
        with native_store.connect() as db:
            rows = db.execute(
                "SELECT id,source FROM tasks WHERE id IN (" + placeholders + ")", keys
            ).fetchall()
        matched = {row["id"]: row["source"] for row in rows}
        for item in approved_tasks:
            found = matched.get("handoff-" + item["id"])
            if found == "bridge:" + LOCAL_SOURCE:
                item["native_state"] = "linked"
            elif found is not None:
                item["native_state"] = "conflict"
            else:
                item["native_state"] = "unlinked"
    pending = sum(x["state"] == "pending" for x in items)
    approved = sum(x["state"] == "approved" for x in items)
    return {"items": items, "pending_in_view": pending,
            "approved_in_view": approved, "page_limit": limit}


def review(bridge_db: Path, *, handoff_id: str, decision: str,
           owner_confirmation: str) -> dict[str, object]:
    """Receiver-only review, identical state+event semantics to existing CLI."""
    if owner_confirmation != APPROVE_CONFIRM:
        raise ValueError("Owner review confirmation required")
    if not isinstance(handoff_id, str) or HANDOFF_ID.fullmatch(handoff_id) is None:
        raise ValueError("Invalid handoff identifier")
    if decision not in ("approve", "reject"):
        raise ValueError("Review decision must be approve or reject")
    new_state = "approved" if decision == "approve" else "rejected"
    with closing(_db(bridge_db, read_only=False)) as db:
        _check_schema(db)
        db.execute("BEGIN IMMEDIATE")
        try:
            row = db.execute(
                "SELECT id,kind,state FROM handoffs WHERE id=?", (handoff_id,)
            ).fetchone()
            if row is None:
                raise ValueError("Unknown handoff")
            if row["kind"] not in SUPPORTED_KINDS:
                raise ValueError("Unsupported handoff kind")
            if row["state"] == new_state:
                # Idempotent same decision; do not create a second audit event.
                db.execute("ROLLBACK")
                return {"state": new_state, "already_reviewed": True}
            if row["state"] != "pending":
                raise ValueError("Handoff already reviewed with a different decision")
            timestamp = datetime.now(timezone.utc).isoformat(timespec="seconds").replace("+00:00","Z")
            result = db.execute(
                "UPDATE handoffs SET state=?,updated_at=? WHERE id=? AND state='pending'",
                (new_state, timestamp, handoff_id),
            )
            if result.rowcount != 1:
                raise ValueError("Handoff changed during review")
            db.execute(
                "INSERT INTO bridge_events (handoff_id,action,at) VALUES(?,?,?)",
                (handoff_id, decision, timestamp),
            )
            db.execute("COMMIT")
        except Exception:
            db.execute("ROLLBACK")
            raise
    return {"state": new_state, "already_reviewed": False}


def preview_import(bridge_db: Path, native_store: Any, *, handoff_id: str) -> dict[str, object]:
    return preview_local_task(bridge_db, native_store, handoff_id=handoff_id)


def import_task(bridge_db: Path, native_store: Any, *, handoff_id: str,
                owner_confirmation: str) -> dict[str, object]:
    """Explicit SECOND decision; never imports on review approval automatically."""
    if owner_confirmation != IMPORT_CONFIRM:
        raise ValueError("Separate task-import confirmation required")
    return link_local_task(
        bridge_db, native_store, handoff_id=handoff_id,
        confirm=IMPORT_CONFIRM,
    )

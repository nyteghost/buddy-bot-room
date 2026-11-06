#!/usr/bin/env python3
"""Experimental local-only, owner-approved bridge handoff -> ADHD native Store.

Design: NO network listener, new peer, peer credential, native bridge toggle,
raw SQL task creation, or automatic import. The already-reviewed sidecar SQLite
queue is the only source. All writes call the installed Store's own methods.

This development library is NOT mounted in the user's Unraid environment.
Do not use it live without validating against the actual installed Store source,
checking its native handoff constraints, and getting separate owner approval.
"""
from __future__ import annotations

import json
from pathlib import Path
import re
from typing import Any

from approved_task_export import export_approved_tasks

# Reserved local provenance name: deliberately NOT a network peer. Never create
# or enable this record in ADHD's peers table.
LOCAL_SOURCE = "pixelpals_local_sidecar"
CONFIRM = "LINK_ONE_APPROVED_PIXEL_PALS_TASK"
ID_RE = re.compile(r"[A-Za-z0-9_-]{8,100}\Z")
REQUIRED_HANDOFF_COLUMNS = {"id", "direction", "peer_id", "kind", "payload", "state"}
REQUIRED_TASK_COLUMNS = {"id", "source"}


def _reviewed_task(bridge_file: Path, handoff_id: str) -> dict[str, Any]:
    if not isinstance(handoff_id, str) or not ID_RE.fullmatch(handoff_id):
        raise ValueError("Invalid handoff identifier")
    task = next(
        (item for item in export_approved_tasks(bridge_file)["tasks"]
         if item["handoff_id"] == handoff_id), None
    )
    if not task:
        raise ValueError("Handoff has not been approved in the receiver queue")
    if task.get("project"):
        raise ValueError("Named project requires mapping before native intake")
    return task


def _payload(task: dict[str, Any]) -> dict[str, str]:
    payload = {"title": task["title"]}
    for field in ("notes", "due_at"):
        if task.get(field) is not None:
            payload[field] = task[field]
    return payload


def _status(store: Any, ident: str, payload: dict[str, str]) -> str:
    # The local file bridge does not use the native HTTP bridge or its tokens.
    # Reject ambiguous configurations rather than silently turning on sharing.
    if store.setting("bridge_enabled", "off") == "on":
        raise ValueError("Native network bridge is enabled; local-only mode not verified")
    # Actual installed Store.connect() is @contextlib.contextmanager and already
    # handles RLock, sqlite3.Row, commit/rollback and close.
    with store.connect() as db:
        for table, required in (
            ("handoffs", REQUIRED_HANDOFF_COLUMNS),
            ("tasks", REQUIRED_TASK_COLUMNS),
        ):
            columns = {row[1] for row in db.execute("PRAGMA table_info(" + table + ")")}
            if not required <= columns:
                raise ValueError("Unsupported native ADHD handoff schema")
        # A peer FK would prohibit the unregistered local provenance principal.
        # Never bypass FK enforcement or write a placeholder peer.
        foreign_keys = db.execute("PRAGMA foreign_key_list(handoffs)").fetchall()
        if any(row[3] == "peer_id" for row in foreign_keys):
            raise ValueError("Native handoff peer FK requires a separate owner-reviewed design")
        # Never reuse a registered remote peer's identity for a local import.
        if db.execute("SELECT 1 FROM peers WHERE id=?", (LOCAL_SOURCE,)).fetchone():
            raise ValueError("Reserved local source collides with a network peer")
        native = db.execute(
            "SELECT direction,peer_id,kind,payload,state FROM handoffs WHERE id=?",
            (ident,),
        ).fetchone()
        task = db.execute(
            "SELECT source FROM tasks WHERE id=?", ("handoff-" + ident,)
        ).fetchone()
    if task and task["source"] != "bridge:" + LOCAL_SOURCE:
        raise ValueError("Native task ID already belongs to a different source")
    if native is None:
        if task:
            raise ValueError("Orphan task ID collision")
        return "unlinked"
    if (native["direction"] != "in" or native["peer_id"] != LOCAL_SOURCE or
        native["kind"] != "task" or json.loads(native["payload"]) != payload):
        raise ValueError("Native handoff ID conflict")
    if native["state"] == "rejected":
        raise ValueError("Native handoff has already been rejected")
    if native["state"] == "approved":
        if task is None:
            raise ValueError("Native approved handoff is missing its task")
        return "linked"
    if native["state"] != "pending" or task is not None:
        raise ValueError("Inconsistent native handoff state")
    return "native-pending"


def preview_local_task(bridge_file: Path, store: Any, *, handoff_id: str) -> dict[str, object]:
    payload = _payload(_reviewed_task(bridge_file, handoff_id))
    state = _status(store, handoff_id, payload)
    return {"mode": "local-only", "receiver_approved": True,
            "native_state": state, "preview_only": True,
            "native_bridge_setting_changed": False,
            "native_peers_changed": False}


def link_local_task(bridge_file: Path, store: Any, *,
                    handoff_id: str, confirm: str) -> dict[str, object]:
    """Owner-initiated one-record link. No task title/content is returned."""
    if confirm != CONFIRM:
        raise ValueError("Explicit local task-link confirmation required")
    payload = _payload(_reviewed_task(bridge_file, handoff_id))
    state = _status(store, handoff_id, payload)
    if state == "linked":
        return {"outcome": "already-linked", "backup_created": False}
    snapshot = store.backup()
    if not isinstance(snapshot, str) or not snapshot or not Path(snapshot).is_file():
        raise ValueError("Native ADHD backup is missing; no handoff applied")
    # Confirm the sidecar has not changed/revoked the approval in the meantime.
    if _payload(_reviewed_task(bridge_file, handoff_id)) != payload:
        raise ValueError("Receiver approval content changed during backup")
    state = _status(store, handoff_id, payload)
    if state == "linked":
        return {"outcome": "already-linked", "backup_created": True}
    receipt = store.create_handoff("task", payload, LOCAL_SOURCE, "in", handoff_id)
    if (receipt.get("id") != handoff_id or receipt.get("state") not in
            ("pending", "approved")):
        raise ValueError("Native Store returned an unexpected handoff receipt")
    if receipt["state"] == "pending":
        store.approve_handoff(handoff_id)
    if _status(store, handoff_id, payload) != "linked":
        raise ValueError("Native handoff did not produce a verified task")
    return {"outcome": "linked", "backup_created": True}

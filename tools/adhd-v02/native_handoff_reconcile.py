#!/usr/bin/env python3
"""Owner-gated adapter from the isolated v0.2 bridge to ADHD-A's *native* Store.

No SQL INSERT/UPDATE/DELETE in this module. All actual task creation goes
through the existing Store.create_handoff() and Store.approve_handoff() methods.

This is an injectable development library, NOT an Unraid installer or live CLI.
Do not wire it into the running ADHD-A process without verifying native Store
construction, peer registration, authentication, and a real restore test.
"""
from __future__ import annotations

import json
from pathlib import Path
import re
from typing import Any

from approved_task_export import export_approved_tasks

CONFIRM = "LINK_APPROVED_HANDOFF_TO_NATIVE_ADHD"
ID_RE = re.compile(r"[A-Za-z0-9_-]{8,100}\Z")
PEER_RE = re.compile(r"[A-Za-z0-9_-]{1,100}\Z")


def _candidate(bridge_db: Path, handoff_id: str) -> dict[str, Any]:
    if not isinstance(handoff_id, str) or not ID_RE.fullmatch(handoff_id):
        raise ValueError("Invalid handoff identifier")
    # The exporter requires BOTH approved receiver state and an approve audit event.
    candidates = export_approved_tasks(bridge_db)["tasks"]
    result = next((x for x in candidates if x["handoff_id"] == handoff_id), None)
    if result is None:
        raise ValueError("No receiver-approved task with this handoff ID")
    if result.get("project"):
        raise ValueError("Project handoff requires an explicit native project mapping")
    return result


def _payload(item: dict[str, Any]) -> dict[str, str]:
    # Native create_handoff requires every present field to be text, never null.
    result = {"title": item["title"]}
    for field in ("notes", "due_at"):
        if item.get(field) is not None:
            result[field] = item[field]
    return result


def _read_native(store: Any, handoff_id: str, peer_id: str, payload: dict[str, str]) -> str:
    # Store setting and peer authorization must remain opt-in, even though
    # the separate receiver sidecar has its own independent approval.
    if store.setting("bridge_enabled", "off") != "on":
        raise ValueError("Native ADHD bridge is disabled")
    # The installed Store.connect() is a @contextmanager, not a bare SQLite
    # connection. Enter it directly to preserve Store's RLock, row factory,
    # commit/rollback and close lifecycle. Native peer must already be enabled.
    with store.connect() as database:
        peer = database.execute("SELECT 1 FROM peers WHERE id=? AND enabled=1", (peer_id,)).fetchone()
        if not peer:
            raise ValueError("Native ADHD peer is not configured and enabled")
        record = database.execute(
            "SELECT direction,peer_id,kind,payload,state FROM handoffs WHERE id=?", (handoff_id,)
        ).fetchone()
        task = database.execute(
            "SELECT source FROM tasks WHERE id=?", ("handoff-" + handoff_id,)
        ).fetchone()
    if task is not None and task["source"] != "bridge:" + peer_id:
        raise ValueError("Native task ID belongs to a different source")
    if record is None:
        if task is not None:
            raise ValueError("Native task ID collision; not overwriting anything")
        return "missing"
    if (record["direction"] != "in" or record["peer_id"] != peer_id or
            record["kind"] != "task" or json.loads(record["payload"]) != payload):
        raise ValueError("Native handoff ID already belongs to different content")
    if record["state"] == "rejected":
        raise ValueError("Native ADHD review rejected this handoff")
    if record["state"] == "approved":
        if task is None:
            raise ValueError("Native approved handoff has no corresponding task")
        return "already-linked"
    if record["state"] != "pending":
        raise ValueError("Unknown native handoff state")
    if task is not None:
        raise ValueError("Pending handoff has a task ID collision")
    return "pending-native"


def preview_native_link(bridge_db: Path, native_store: Any, *, handoff_id: str, peer_id: str) -> dict[str, object]:
    if not isinstance(peer_id, str) or not PEER_RE.fullmatch(peer_id):
        raise ValueError("Invalid registered peer identifier")
    item = _candidate(bridge_db, handoff_id)
    state = _read_native(native_store, handoff_id, peer_id, _payload(item))
    return {"reviewed_on_bridge": True, "handoff_kind": "task",
            "native_state": state, "would_create_task": state in ("missing", "pending-native"),
            "preview_only": True}


def link_one_reviewed_task(
    bridge_db: Path, native_store: Any, *, handoff_id: str, peer_id: str, confirm: str
) -> dict[str, object]:
    """Explicit opt-in only; uses native Store methods and a native backup.

    An interrupted call after create_handoff but before approval leaves a
    *pending* native handoff; a retry completes it safely. A second completed
    call returns already-linked without a new backup or task.
    """
    if confirm != CONFIRM:
        raise ValueError("Explicit native handoff-link approval required")
    if not isinstance(peer_id, str) or not PEER_RE.fullmatch(peer_id):
        raise ValueError("Invalid registered peer identifier")
    item = _candidate(bridge_db, handoff_id)
    payload = _payload(item)
    state = _read_native(native_store, handoff_id, peer_id, payload)
    if state == "already-linked":
        return {"outcome": "already-linked", "task_created_by": "native-adhd-store",
                "new_backup_created": False}
    backup = native_store.backup()
    if not isinstance(backup, str) or not backup:
        raise ValueError("Native ADHD backup did not return a recovery checkpoint")
    # Reconfirm the bridge's actual owner approval after the backup completes.
    if _payload(_candidate(bridge_db, handoff_id)) != payload:
        raise ValueError("Receiver-approved task changed during preparation")
    state = _read_native(native_store, handoff_id, peer_id, payload)
    if state == "already-linked":
        return {"outcome": "already-linked", "task_created_by": "native-adhd-store",
                "new_backup_created": True}
    receipt = native_store.create_handoff("task", payload, peer_id, "in", handoff_id)
    if receipt.get("id") != handoff_id or receipt.get("state") not in ("pending", "approved"):
        raise ValueError("Native Store returned an unexpected handoff receipt")
    if receipt["state"] == "pending":
        native_store.approve_handoff(handoff_id)
    if _read_native(native_store, handoff_id, peer_id, payload) != "already-linked":
        raise ValueError("Native ADHD did not confirm an approved handoff and created task")
    return {"outcome": "linked", "task_created_by": "native-adhd-store",
            "new_backup_created": True}

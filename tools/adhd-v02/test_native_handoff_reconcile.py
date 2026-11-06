#!/usr/bin/env python3
"""Disposable bridge + native Store fixture tests for approved handoff linking."""
from __future__ import annotations

from contextlib import contextmanager
import json
from pathlib import Path
import sqlite3
import sys
import tempfile
import unittest

HERE = Path(__file__).resolve().parent
sys.path.insert(0, str(HERE))
from native_handoff_reconcile import CONFIRM, link_one_reviewed_task, preview_native_link


class FakeNativeStore:
    """Models observed database.py public methods and handoff approval semantics."""
    def __init__(self, root: Path):
        self.path = root / "adhd.sqlite3"
        self.backups = 0
        self.native_bridge_enabled = True
        self.fail_approval_once = False
        with self.connect() as db:
            db.executescript("""CREATE TABLE peers (id TEXT PRIMARY KEY,enabled INTEGER);
              CREATE TABLE handoffs(id TEXT PRIMARY KEY,direction TEXT,peer_id TEXT,kind TEXT,
                payload TEXT,state TEXT,created_at TEXT,updated_at TEXT);
              CREATE TABLE tasks(id TEXT PRIMARY KEY,title TEXT,notes TEXT NOT NULL DEFAULT '',
                due_at TEXT,status TEXT NOT NULL DEFAULT 'open',project_id TEXT,source TEXT,
                created_at TEXT,updated_at TEXT);
              CREATE TABLE audit(id INTEGER PRIMARY KEY, action TEXT);
              INSERT INTO peers(id,enabled) VALUES('pixelpals',1);""")
    def setting(self, name, default="off"):
        return "on" if name == "bridge_enabled" and self.native_bridge_enabled else default
    @contextmanager
    def connect(self):
        # Mirrors the installed native Store.connect() lifecycle instead of
        # returning a bare sqlite3.Connection.
        connection = sqlite3.connect(self.path)
        connection.row_factory = sqlite3.Row
        try:
            yield connection
            connection.commit()
        except Exception:
            connection.rollback()
            raise
        finally:
            connection.close()
    def backup(self):
        self.backups += 1
        with self.connect() as db:
            with sqlite3.connect(self.path.parent / f"safe-backup-{self.backups}.sqlite3") as dest:
                db.backup(dest)
        return str(self.path.parent / f"safe-backup-{self.backups}.sqlite3")
    def create_handoff(self, kind, payload, peer_id, direction, message_id):
        with self.connect() as db:
            row = db.execute("SELECT direction,peer_id,kind,payload,state FROM handoffs WHERE id=?",
                             (message_id,)).fetchone()
            if row:
                if (row["direction"] != direction or row["peer_id"] != peer_id
                   or row["kind"] != kind or json.loads(row["payload"]) != payload):
                    raise ValueError("Message ID conflict")
                return {"id": message_id, "duplicate": True, "state": row["state"]}
            db.execute("INSERT INTO handoffs VALUES(?,?,?,?,?,'pending','now','now')",
                       (message_id,direction,peer_id,kind,json.dumps(payload)))
            db.execute("INSERT INTO audit(action) VALUES('handoff.received')")
        return {"id": message_id, "duplicate": False, "state": "pending"}
    def approve_handoff(self, ident):
        if self.fail_approval_once:
            self.fail_approval_once = False
            raise RuntimeError("Simulated interruption after native handoff creation")
        with self.connect() as db:
            row = db.execute("SELECT * FROM handoffs WHERE id=?", (ident,)).fetchone()
            if not row or row["state"] != "pending":
                raise ValueError("Only pending handoffs can be approved")
            payload = json.loads(row["payload"])
            if row["kind"] == "task" and row["direction"] == "in":
                db.execute("INSERT INTO tasks VALUES(?,?,?,?,?,?,?,'now','now')",
                           ("handoff-" + ident,payload["title"],payload.get("notes",""),
                            payload.get("due_at") or None,"open",None,"bridge:" + row["peer_id"]))
            db.execute("UPDATE handoffs SET state='approved' WHERE id=?", (ident,))
            db.execute("INSERT INTO audit(action) VALUES('handoff.approved')")


class NativeLinkTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.addCleanup(self.temp.cleanup)
        self.root = Path(self.temp.name)
        self.bridge = self.root / "bridge-v02.sqlite3"
        self.store = FakeNativeStore(self.root)
        with sqlite3.connect(self.bridge) as db:
            db.execute("CREATE TABLE handoffs(id TEXT PRIMARY KEY,kind TEXT,payload TEXT,state TEXT,created_at TEXT,updated_at TEXT)")
            db.execute("CREATE TABLE bridge_events(id INTEGER PRIMARY KEY,handoff_id TEXT,action TEXT,at TEXT)")
    def source(self, ident="handoff0001", *, approved=True, kind="task", project=None, notes=None, event=True):
        payload = {"title": "PRIVATE TITLE"}
        if notes is not None:
            payload["notes"] = notes
        if project:
            payload["project"] = project
        with sqlite3.connect(self.bridge) as db:
            db.execute("INSERT INTO handoffs VALUES(?,?,?,?,?,?)",
                       (ident,kind,json.dumps(payload),"approved" if approved else "pending","now","now"))
            if event:
                db.execute("INSERT INTO bridge_events(handoff_id,action,at) VALUES(?,?,?)",
                           (ident,"approve","2026-11-06T12:00:00Z"))
    def read(self, sql):
        with self.store.connect() as db:
            return db.execute(sql).fetchall()

    def test_fake_store_context_manager_really_closes_connection(self):
        with self.store.connect() as db:
            self.assertEqual(db.execute("SELECT COUNT(*) FROM peers").fetchone()[0], 1)
        with self.assertRaises(sqlite3.ProgrammingError):
            db.execute("SELECT 1")

    def test_fake_store_context_manager_rolls_back_raises(self):
        with self.assertRaisesRegex(RuntimeError, "stop"):
            with self.store.connect() as db:
                db.execute("INSERT INTO audit(action) VALUES('SHOULD_ROLL_BACK')")
                raise RuntimeError("stop")
        self.assertFalse(self.read("SELECT * FROM audit"))

    def test_preview_requires_receiver_approval_and_never_writes(self):
        self.source()
        before = self.store.path.read_bytes()
        result = preview_native_link(self.bridge,self.store,handoff_id="handoff0001",peer_id="pixelpals")
        self.assertEqual(result["native_state"],"missing")
        self.assertTrue(result["preview_only"])
        self.assertEqual(self.store.backups,0)
        self.assertEqual(self.store.path.read_bytes(),before)

    def test_link_uses_native_approval_audit_and_idempotency(self):
        self.source()
        before = self.read("SELECT * FROM tasks")
        self.assertEqual(before, [])
        first = link_one_reviewed_task(self.bridge,self.store,
            handoff_id="handoff0001",peer_id="pixelpals",confirm=CONFIRM)
        self.assertEqual(first["outcome"],"linked")
        self.assertEqual(self.store.backups,1)
        task = self.read("SELECT id,notes,status,source FROM tasks")[0]
        self.assertEqual(tuple(task),("handoff-handoff0001","","open","bridge:pixelpals"))
        self.assertTrue(self.read("SELECT 1 FROM audit WHERE action='handoff.approved'"))
        again = link_one_reviewed_task(self.bridge,self.store,
            handoff_id="handoff0001",peer_id="pixelpals",confirm=CONFIRM)
        self.assertEqual(again["outcome"],"already-linked")
        self.assertEqual(self.store.backups,1)
        self.assertEqual(len(self.read("SELECT id FROM tasks")),1)
        self.assertNotIn("PRIVATE TITLE",str(first))

    def test_missing_confirmation_refuses_without_backup(self):
        self.source()
        with self.assertRaisesRegex(ValueError,"Explicit native"):
            link_one_reviewed_task(self.bridge,self.store,
                handoff_id="handoff0001",peer_id="pixelpals",confirm="NO")
        self.assertEqual(len(self.read("SELECT id FROM handoffs")),0)
        self.assertEqual(self.store.backups,0)

    def test_pending_or_tampered_bridge_state_is_not_enough(self):
        self.source(approved=False)
        with self.assertRaisesRegex(ValueError,"No receiver-approved"):
            preview_native_link(self.bridge,self.store,handoff_id="handoff0001",peer_id="pixelpals")
        self.source("handoff0002",event=False)
        with self.assertRaisesRegex(ValueError,"No receiver-approved"):
            link_one_reviewed_task(self.bridge,self.store,
                handoff_id="handoff0002",peer_id="pixelpals",confirm=CONFIRM)
        self.assertEqual(self.store.backups,0)

    def test_project_name_requires_mapping_and_disabled_peer_fails(self):
        self.source(project="CGC")
        with self.assertRaisesRegex(ValueError,"project mapping"):
            preview_native_link(self.bridge,self.store,handoff_id="handoff0001",peer_id="pixelpals")
        with sqlite3.connect(self.bridge) as db:
            db.execute("UPDATE handoffs SET payload=? WHERE id=?",
                       (json.dumps({"title":"PRIVATE TITLE"}),"handoff0001"))
        with self.store.connect() as db:
            db.execute("UPDATE peers SET enabled=0 WHERE id='pixelpals'")
        with self.assertRaisesRegex(ValueError,"not configured"):
            preview_native_link(self.bridge,self.store,handoff_id="handoff0001",peer_id="pixelpals")

    def test_retry_recovers_native_pending_after_interruption(self):
        self.source()
        self.store.fail_approval_once = True
        with self.assertRaisesRegex(RuntimeError,"Simulated interruption"):
            link_one_reviewed_task(self.bridge,self.store,
                handoff_id="handoff0001",peer_id="pixelpals",confirm=CONFIRM)
        self.assertEqual(self.read("SELECT state FROM handoffs")[0][0],"pending")
        self.assertFalse(self.read("SELECT id FROM tasks"))
        result=link_one_reviewed_task(self.bridge,self.store,
                handoff_id="handoff0001",peer_id="pixelpals",confirm=CONFIRM)
        self.assertEqual(result["outcome"],"linked")
        self.assertEqual(len(self.read("SELECT id FROM tasks")),1)

    def test_wrong_native_payload_never_approved(self):
        self.source()
        with self.store.connect() as db:
            db.execute("INSERT INTO handoffs VALUES(?,?,?,?,?,'pending','now','now')",
                       ("handoff0001","in","pixelpals","task",json.dumps({"title":"OTHER"})))
        with self.assertRaisesRegex(ValueError,"different content"):
            link_one_reviewed_task(self.bridge,self.store,
                handoff_id="handoff0001",peer_id="pixelpals",confirm=CONFIRM)
        self.assertEqual(self.store.backups,0)

    def test_rejected_native_handoff_is_not_overridden(self):
        self.source()
        with self.store.connect() as db:
            db.execute("INSERT INTO handoffs VALUES(?,?,?,?,?,'rejected','now','now')",
                       ("handoff0001","in","pixelpals","task",json.dumps({"title":"PRIVATE TITLE"})))
        with self.assertRaisesRegex(ValueError,"rejected"):
            link_one_reviewed_task(self.bridge,self.store,
                handoff_id="handoff0001",peer_id="pixelpals",confirm=CONFIRM)
        self.assertEqual(self.store.backups,0)

    def test_disabled_native_bridge_fails_before_backup_and_mutation(self):
        self.source()
        self.store.native_bridge_enabled = False
        with self.assertRaisesRegex(ValueError, "bridge is disabled"):
            link_one_reviewed_task(self.bridge,self.store,
                handoff_id="handoff0001",peer_id="pixelpals",confirm=CONFIRM)
        self.assertFalse(self.read("SELECT * FROM handoffs"))
        self.assertEqual(self.store.backups, 0)

    def test_native_task_source_collision_fails_closed(self):
        self.source()
        with self.store.connect() as db:
            db.execute("INSERT INTO handoffs VALUES(?,?,?,?,?,'approved','now','now')",
                ("handoff0001","in","pixelpals","task",json.dumps({"title":"PRIVATE TITLE"})))
            db.execute("INSERT INTO tasks VALUES(?,?,?,?,?,?,?,'now','now')",
                ("handoff-handoff0001", "PRIVATE title from elsewhere", "", None,
                 "open", None, "manual"))
        with self.assertRaisesRegex(ValueError, "different source"):
            link_one_reviewed_task(self.bridge,self.store,
                handoff_id="handoff0001",peer_id="pixelpals",confirm=CONFIRM)
        self.assertEqual(self.store.backups, 0)

    def test_backup_failure_does_not_mutate_native_queue(self):
        self.source()
        def failed_backup():
            raise OSError("Simulated backup failure")
        self.store.backup = failed_backup
        with self.assertRaisesRegex(OSError,"backup failure"):
            link_one_reviewed_task(self.bridge,self.store,
                handoff_id="handoff0001",peer_id="pixelpals",confirm=CONFIRM)
        self.assertEqual(self.read("SELECT * FROM handoffs"),[])
        self.assertEqual(self.read("SELECT * FROM tasks"),[])


if __name__ == "__main__":
    unittest.main()

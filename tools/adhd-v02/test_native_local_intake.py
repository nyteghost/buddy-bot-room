#!/usr/bin/env python3
"""Safety checks for a *local-only* approved handoff against disposable SQLite."""
from __future__ import annotations

import json
from pathlib import Path
import sqlite3
import sys
import tempfile
import unittest

HERE = Path(__file__).resolve().parent
sys.path.insert(0, str(HERE))
from native_local_intake import CONFIRM, LOCAL_SOURCE, link_local_task, preview_local_task
from test_native_handoff_reconcile import FakeNativeStore


class LocalIntakeTests(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self.addCleanup(self.tmp.cleanup)
        self.root = Path(self.tmp.name)
        self.store = FakeNativeStore(self.root)
        self.store.native_bridge_enabled = False
        # The real user's native ADHD-A has zero enabled peers; local intake
        # must work without creating/activating any of them.
        with self.store.connect() as db:
            db.execute("DELETE FROM peers")
        self.bridge = self.root / "bridge-v02.sqlite3"
        with sqlite3.connect(self.bridge) as db:
            db.execute("CREATE TABLE handoffs (id TEXT PRIMARY KEY,kind TEXT,payload TEXT,state TEXT,created_at TEXT,updated_at TEXT)")
            db.execute("CREATE TABLE bridge_events (id INTEGER PRIMARY KEY,handoff_id TEXT,action TEXT,at TEXT)")

    def handoff(self, ident="localtask0001", *, approved=True, event=True,
                kind="task", project=None, notes=None):
        data = {"title": "PRIVATE TEST TASK"}
        if notes is not None:
            data["notes"] = notes
        if project:
            data["project"] = project
        with sqlite3.connect(self.bridge) as db:
            db.execute("INSERT INTO handoffs VALUES(?,?,?,?,?,?)", (
                ident,kind,json.dumps(data),
                "approved" if approved else "pending",
                "2026-11-06T12:00:00Z","2026-11-06T12:01:00Z"
            ))
            if event:
                db.execute("INSERT INTO bridge_events(handoff_id,action,at) VALUES(?,?,?)", (
                    ident, "approve", "2026-11-06T12:01:00Z"
                ))

    def native_count(self, table):
        with self.store.connect() as db:
            return db.execute("SELECT COUNT(*) FROM " + table).fetchone()[0]

    def test_preview_does_not_write_or_expose_private_task(self):
        self.handoff()
        before = (self.store.path.read_bytes(), self.bridge.read_bytes())
        plan = preview_local_task(self.bridge, self.store, handoff_id="localtask0001")
        self.assertTrue(plan["preview_only"])
        self.assertEqual(plan["native_state"], "unlinked")
        self.assertFalse(plan["native_peers_changed"])
        self.assertNotIn("PRIVATE", json.dumps(plan))
        self.assertEqual(before,(self.store.path.read_bytes(), self.bridge.read_bytes()))
        self.assertEqual(self.native_count("peers"), 0)

    def test_link_creates_native_audited_task_without_enabling_network_peer(self):
        self.handoff(notes=None)
        outcome = link_local_task(self.bridge,self.store,handoff_id="localtask0001",confirm=CONFIRM)
        self.assertEqual(outcome["outcome"], "linked")
        self.assertTrue(outcome["backup_created"])
        self.assertEqual(self.native_count("peers"), 0)
        self.assertFalse(self.store.native_bridge_enabled)
        with self.store.connect() as db:
            rows=db.execute("SELECT id,title,notes,status,source FROM tasks").fetchall()
            self.assertEqual(len(rows), 1)
            self.assertEqual(tuple(rows[0]), (
                "handoff-localtask0001", "PRIVATE TEST TASK", "", "open",
                "bridge:" + LOCAL_SOURCE
            ))
            audits=[row[0] for row in db.execute("SELECT action FROM audit")]
            self.assertIn("handoff.approved", audits)
        self.assertEqual(self.store.backups,1)
        again=link_local_task(self.bridge,self.store,handoff_id="localtask0001",confirm=CONFIRM)
        self.assertEqual(again["outcome"], "already-linked")
        self.assertFalse(again["backup_created"])
        self.assertEqual(self.store.backups,1)
        self.assertNotIn("PRIVATE",str(outcome))

    def test_confirmation_is_mandatory_and_prevents_backup(self):
        self.handoff()
        with self.assertRaisesRegex(ValueError,"Explicit local"):
            link_local_task(self.bridge,self.store,handoff_id="localtask0001",confirm="NO")
        self.assertEqual(self.store.backups,0)
        self.assertEqual(self.native_count("tasks"),0)

    def test_sidecar_pending_or_unaudited_approval_is_not_eligible(self):
        self.handoff("notapproved01",approved=False,event=False)
        self.handoff("nomatchevent1",approved=True,event=False)
        for ident in ("notapproved01","nomatchevent1"):
            with self.assertRaisesRegex(ValueError,"not been approved"):
                link_local_task(self.bridge,self.store,handoff_id=ident,confirm=CONFIRM)
        self.assertEqual(self.store.backups,0)

    def test_named_project_does_not_get_silently_mapped(self):
        self.handoff(project="Cobb Galleria Centre")
        with self.assertRaisesRegex(ValueError,"project"):
            preview_local_task(self.bridge,self.store,handoff_id="localtask0001")

    def test_collision_with_registered_network_peer_refused(self):
        self.handoff()
        with self.store.connect() as db:
            db.execute("INSERT INTO peers VALUES(?,?)", (LOCAL_SOURCE,0))
        with self.assertRaisesRegex(ValueError,"collides"):
            link_local_task(self.bridge,self.store,handoff_id="localtask0001",confirm=CONFIRM)
        self.assertEqual(self.store.backups,0)

    def test_native_bridge_enabled_is_not_a_local_only_mode(self):
        self.handoff()
        self.store.native_bridge_enabled=True
        with self.assertRaisesRegex(ValueError,"network bridge"):
            link_local_task(self.bridge,self.store,handoff_id="localtask0001",confirm=CONFIRM)
        self.assertEqual(self.store.backups,0)

    def test_peer_foreign_key_blocks_unregistered_local_provenance(self):
        self.handoff()
        with self.store.connect() as db:
            db.execute("DROP TABLE handoffs")
            db.execute("""CREATE TABLE handoffs(
                id TEXT PRIMARY KEY,direction TEXT,
                peer_id TEXT REFERENCES peers(id),kind TEXT,
                payload TEXT,state TEXT,created_at TEXT,updated_at TEXT)""")
        with self.assertRaisesRegex(ValueError,"peer FK"):
            link_local_task(self.bridge,self.store,handoff_id="localtask0001",confirm=CONFIRM)
        self.assertEqual(self.store.backups,0)

    def test_native_pending_after_interruption_can_be_completed_explicitly(self):
        self.handoff()
        self.store.fail_approval_once=True
        with self.assertRaisesRegex(RuntimeError,"Simulated interruption"):
            link_local_task(self.bridge,self.store,handoff_id="localtask0001",confirm=CONFIRM)
        with self.store.connect() as db:
            self.assertEqual(db.execute("SELECT state FROM handoffs").fetchone()[0], "pending")
        outcome=link_local_task(self.bridge,self.store,handoff_id="localtask0001",confirm=CONFIRM)
        self.assertEqual(outcome["outcome"],"linked")
        self.assertEqual(self.native_count("tasks"),1)

    def test_rejected_native_handoff_cannot_be_overridden(self):
        self.handoff()
        with self.store.connect() as db:
            db.execute("INSERT INTO handoffs VALUES(?,?,?,?,?,'rejected','now','now')",(
                "localtask0001","in",LOCAL_SOURCE,"task",json.dumps({"title":"PRIVATE TEST TASK"})
            ))
        with self.assertRaisesRegex(ValueError,"rejected"):
            link_local_task(self.bridge,self.store,handoff_id="localtask0001",confirm=CONFIRM)

    def test_bad_native_backup_disallows_intake(self):
        self.handoff()
        self.store.backup=lambda: None
        with self.assertRaisesRegex(ValueError,"backup is missing"):
            link_local_task(self.bridge,self.store,handoff_id="localtask0001",confirm=CONFIRM)
        self.assertEqual(self.native_count("tasks"),0)
        self.assertEqual(self.native_count("handoffs"),0)

    def test_existing_task_id_from_another_source_blocks(self):
        self.handoff()
        with self.store.connect() as db:
            db.execute("INSERT INTO tasks VALUES(?,?,?,?,?,?,?,'now','now')",(
                "handoff-localtask0001","Someone else","",None,"open",None,"manual"
            ))
        with self.assertRaisesRegex(ValueError,"different source"):
            link_local_task(self.bridge,self.store,handoff_id="localtask0001",confirm=CONFIRM)
        self.assertEqual(self.store.backups,0)


if __name__=="__main__":
    unittest.main()

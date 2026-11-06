#!/usr/bin/env python3
"""Disposable SQLite fixtures for the dry-run ADHD task intake preview."""
from __future__ import annotations

import importlib.util
import json
from pathlib import Path
import sqlite3
import subprocess
import sys
import tempfile
import unittest

SOURCE = Path(__file__).with_name("approved_task_plan.py")
spec = importlib.util.spec_from_file_location("approved_task_plan", SOURCE)
assert spec and spec.loader
module = importlib.util.module_from_spec(spec)
spec.loader.exec_module(module)


class ApprovedTaskPreviewTests(unittest.TestCase):
    def setUp(self):
        self.folder = tempfile.TemporaryDirectory()
        self.addCleanup(self.folder.cleanup)
        self.root = Path(self.folder.name)
        self.bridge = self.root / "bridge-v02.sqlite3"
        self.adhd = self.root / "adhd.sqlite3"
        with sqlite3.connect(self.bridge) as db:
            db.execute("""CREATE TABLE handoffs(
                id TEXT PRIMARY KEY,kind TEXT,payload TEXT,state TEXT,created_at TEXT,updated_at TEXT)""")
            db.execute("""CREATE TABLE bridge_events(
                id INTEGER PRIMARY KEY,handoff_id TEXT,action TEXT,at TEXT)""")
        with sqlite3.connect(self.adhd) as db:
            db.execute("""CREATE TABLE tasks(
                id TEXT PRIMARY KEY,title TEXT,notes TEXT,due_at TEXT,status TEXT,
                project_id TEXT,source TEXT,created_at TEXT,updated_at TEXT)""")

    def handoff(self, ident, state="approved", kind="task", project=None, event="approve"):
        payload = {"title": "PRIVATE TASK TITLE", "notes": "PRIVATE TASK NOTES"}
        if project:
            payload["project"] = project
        with sqlite3.connect(self.bridge) as db:
            db.execute("INSERT INTO handoffs VALUES(?,?,?,?,?,?)", (
                ident, kind, json.dumps(payload), state, "2026-11-05T19:00:00Z", "2026-11-05T19:10:00Z",
            ))
            if event:
                db.execute("INSERT INTO bridge_events(handoff_id,action,at) VALUES(?,?,?)", (
                    ident, event, "2026-11-05T19:10:00Z",
                ))

    def task(self, source):
        with sqlite3.connect(self.adhd) as db:
            db.execute("INSERT INTO tasks VALUES(?,?,?,?,?,?,?,?,?)", (
                "task" + str(db.execute("SELECT COUNT(*) FROM tasks").fetchone()[0] + 1),
                "PRIVATE EXISTING TITLE", None, None, "todo", None, source,
                "2026-11-05T19:00:00Z", "2026-11-05T19:00:00Z",
            ))

    def test_approval_receipt_and_exclusions(self):
        self.handoff("handoff001")
        self.handoff("handoff002", state="pending", event=None)
        self.handoff("handoff003", state="rejected", event="reject")
        self.handoff("handoff004", state="approved", kind="note")
        self.handoff("handoff005", state="approved", event=None)
        self.task("manual")
        before = (self.bridge.read_bytes(), self.adhd.read_bytes())
        result = module.preview_approved_tasks(self.bridge, self.adhd)
        self.assertEqual(result["approved_handoffs"], 1)
        self.assertEqual(result["ready_for_explicit_import"], 1)
        self.assertEqual(result["already_present"], 0)
        self.assertFalse(result["automatic_creation_enabled"])
        self.assertFalse(result["database_modified"])
        self.assertEqual(before, (self.bridge.read_bytes(), self.adhd.read_bytes()))

    def test_idempotent_sources_and_project_mapping(self):
        self.handoff("handoff001")
        self.handoff("handoff002", project="CGC Operations")
        self.task("pixel-pals:handoff001")
        plan = module.preview_approved_tasks(self.bridge, self.adhd)
        self.assertEqual(plan["ready_for_explicit_import"], 0)
        self.assertEqual(plan["already_present"], 1)
        self.assertEqual(plan["needs_project_mapping"], 1)
        self.assertEqual(module.preview_approved_tasks(self.bridge, self.adhd), plan)

    def test_duplicate_source_fails_closed(self):
        self.handoff("handoff001")
        self.task("pixel-pals:handoff001")
        self.task("pixel-pals:handoff001")
        with self.assertRaisesRegex(ValueError, "Multiple existing ADHD tasks"):
            module.preview_approved_tasks(self.bridge, self.adhd)

    def test_unknown_schema_fails_closed(self):
        with sqlite3.connect(self.adhd) as db:
            db.execute("DROP TABLE tasks")
            db.execute("CREATE TABLE tasks(id TEXT PRIMARY KEY, title TEXT)")
        with self.assertRaisesRegex(ValueError, "differs from verified"):
            module.preview_approved_tasks(self.bridge, self.adhd)

    def test_missing_task_db_does_not_initialize_it(self):
        self.adhd.unlink()
        with self.assertRaises(FileNotFoundError):
            module.preview_approved_tasks(self.bridge, self.adhd)
        self.assertFalse(self.adhd.exists())

    def test_cli_does_not_print_private_task_data(self):
        self.handoff("handoff001")
        result = subprocess.run([
            sys.executable, str(SOURCE),
            "--bridge-data-dir", str(self.root),
            "--adhd-data-dir", str(self.root),
        ], text=True, capture_output=True)
        self.assertEqual(result.returncode, 0, result.stderr)
        self.assertEqual(json.loads(result.stdout)["approved_handoffs"], 1)
        self.assertNotIn("PRIVATE TASK", result.stdout)
        self.assertNotIn("handoff001", result.stdout)
        self.assertEqual(result.stderr, "")


if __name__ == "__main__":
    unittest.main()

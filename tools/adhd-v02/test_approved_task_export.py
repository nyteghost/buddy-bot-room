#!/usr/bin/env python3
"""Offline regression tests; no running ADHD-A or Pixel Pals needed."""
from __future__ import annotations

import importlib.util
import json
from pathlib import Path
import sqlite3
import subprocess
import sys
import tempfile
import unittest

SOURCE = Path(__file__).with_name("approved_task_export.py")
spec = importlib.util.spec_from_file_location("approved_task_export", SOURCE)
assert spec and spec.loader
module = importlib.util.module_from_spec(spec)
spec.loader.exec_module(module)


class ApprovedTaskExportTests(unittest.TestCase):
    def setUp(self):
        self.directory = tempfile.TemporaryDirectory()
        self.addCleanup(self.directory.cleanup)
        self.data = Path(self.directory.name)
        self.database = self.data / "bridge-v02.sqlite3"
        with sqlite3.connect(self.database) as db:
            db.execute("CREATE TABLE handoffs(id TEXT PRIMARY KEY,kind TEXT,payload TEXT,state TEXT,created_at TEXT,updated_at TEXT)")
            db.execute("CREATE TABLE bridge_events(id INTEGER PRIMARY KEY,handoff_id TEXT,action TEXT,at TEXT)")

    def put(self, ident, state, kind="task", payload=None, event="approve"):
        if payload is None:
            payload = {"title": "Check ShowPilot", "notes": "Test approved export", "due_at": "2026-11-06T10:00:00Z"}
        with sqlite3.connect(self.database) as db:
            db.execute("INSERT INTO handoffs VALUES (?, ?, ?, ?, ?, ?)", (ident, kind, json.dumps(payload), state, "2026-11-05T19:00:00Z", "2026-11-05T19:10:00Z"))
            if event:
                db.execute("INSERT INTO bridge_events(handoff_id,action,at) VALUES (?, ?, ?)", (ident, event, "2026-11-05T19:10:00Z"))

    def test_only_explicitly_approved_tasks_with_approval_events(self):
        self.put("approved001", "approved")
        self.put("pending0001", "pending", event=None)
        self.put("rejected001", "rejected", event="reject")
        self.put("approvednote01", "approved", kind="note")
        self.put("tampered001", "approved", event=None)
        result = module.export_approved_tasks(self.database)
        self.assertEqual(result["format"], "adhd-assistant-approved-task-intake")
        self.assertEqual(len(result["tasks"]), 1)
        self.assertEqual(result["tasks"][0]["source_id"], "pixel-pals:approved001")
        self.assertEqual(result["tasks"][0]["due_at"], "2026-11-06T10:00:00Z")
        self.assertEqual(module.export_approved_tasks(self.database), result)

    def test_reject_corrupt_payload_no_partial_export(self):
        self.put("approved001", "approved")
        self.put("malicious001", "approved", payload={"title": "Safe", "script": "import os"})
        with self.assertRaisesRegex(ValueError, "Unexpected fields"):
            module.export_approved_tasks(self.database)

    def test_does_not_create_missing_database(self):
        missing = self.data / "never-created.sqlite3"
        with self.assertRaises(FileNotFoundError):
            module.export_approved_tasks(missing)
        self.assertFalse(missing.exists())

    def test_cli_is_read_only_and_emits_valid_json(self):
        self.put("approved001", "approved")
        result = subprocess.run([sys.executable, str(SOURCE), "--data-dir", str(self.data)], text=True, capture_output=True)
        self.assertEqual(result.returncode, 0, result.stderr)
        payload = json.loads(result.stdout)
        self.assertEqual(payload["tasks"][0]["handoff_id"], "approved001")
        with sqlite3.connect(self.database) as db:
            self.assertEqual(db.execute("SELECT COUNT(*) FROM handoffs").fetchone()[0], 1)
            self.assertEqual(db.execute("SELECT COUNT(*) FROM bridge_events").fetchone()[0], 1)

    def test_reject_unbounded_export(self):
        with sqlite3.connect(self.database) as db:
            entries = [(f"approved{i:04}", "task", '{"title":"Safe"}', "approved", "2026-11-05T19:00:00Z", "2026-11-05T19:10:00Z") for i in range(501)]
            db.executemany("INSERT INTO handoffs VALUES (?, ?, ?, ?, ?, ?)", entries)
            db.executemany("INSERT INTO bridge_events(handoff_id,action,at) VALUES (?, 'approve', '2026-11-05T19:10:00Z')", ((e[0],) for e in entries))
        with self.assertRaisesRegex(ValueError, "truncated"):
            module.export_approved_tasks(self.database)


if __name__ == "__main__":
    unittest.main()

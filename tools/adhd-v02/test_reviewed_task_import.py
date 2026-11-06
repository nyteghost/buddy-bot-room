#!/usr/bin/env python3
"""Safety regressions for the optional ADHD task importer. Fixture DBs only."""
from __future__ import annotations

import importlib.util
import json
from pathlib import Path
import sqlite3
import subprocess
import sys
import tempfile
import unittest

HERE = Path(__file__).resolve().parent
sys.path.insert(0, str(HERE))
SOURCE = HERE / "reviewed_task_import.py"
spec = importlib.util.spec_from_file_location("reviewed_task_import", SOURCE)
assert spec and spec.loader
module = importlib.util.module_from_spec(spec)
spec.loader.exec_module(module)


class ImportSafetyTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.addCleanup(self.temp.cleanup)
        self.root = Path(self.temp.name)
        self.bridge = self.root / "bridge-v02.sqlite3"
        self.tasks = self.root / "adhd.sqlite3"
        self.backup_dir = self.root / "private-backups"
        self.backup_dir.mkdir(mode=0o700)
        with sqlite3.connect(self.bridge) as db:
            db.execute("CREATE TABLE handoffs (id TEXT PRIMARY KEY,kind TEXT,payload TEXT,state TEXT,created_at TEXT,updated_at TEXT)")
            db.execute("CREATE TABLE bridge_events (id INTEGER PRIMARY KEY,handoff_id TEXT,action TEXT,at TEXT)")
        with sqlite3.connect(self.tasks) as db:
            db.execute("""CREATE TABLE tasks (
                id TEXT PRIMARY KEY, title TEXT, notes TEXT, due_at TEXT,
                status TEXT, project_id TEXT, source TEXT, created_at TEXT,updated_at TEXT
            )""")
            db.execute("INSERT INTO tasks VALUES(?,?,?,?,?,?,?,?,?)", (
                "existing-row", "PRIVATE existing", None, None, "inbox", None, "manual",
                "2026-11-05T20:00:00Z", "2026-11-05T20:00:00Z",
            ))

    def handoff(self, ident, title="PRIVATE import", *, state="approved", kind="task", project=None, approval=True):
        data = {"title": title, "notes": "PRIVATE notes", "due_at": "2026-11-06T10:00:00Z"}
        if project is not None:
            data["project"] = project
        with sqlite3.connect(self.bridge) as db:
            db.execute("INSERT INTO handoffs VALUES (?,?,?,?,?,?)", (
                ident,kind,json.dumps(data),state,"2026-11-05T19:00:00Z","2026-11-05T20:00:00Z"))
            if approval:
                db.execute("INSERT INTO bridge_events (handoff_id,action,at) VALUES (?,?,?)", (
                    ident,"approve","2026-11-05T20:00:00Z",
                ))

    def task_rows(self):
        with sqlite3.connect(self.tasks) as db:
            return db.execute("SELECT id, title, source, status, project_id FROM tasks ORDER BY id").fetchall()

    def apply(self, status="inbox", confirm=module.CONFIRM_PHRASE):
        return module.apply_explicitly_approved(
            self.bridge,self.tasks,task_status=status,confirm=confirm,backup_dir=self.backup_dir)

    def test_preview_is_read_only_and_aggregated(self):
        self.handoff("approved0001")
        self.handoff("pending00002",state="pending",approval=False)
        self.handoff("rejected0001",state="rejected",approval=False)
        self.handoff("approvednote",kind="note")
        self.handoff("needsreview1",project="Operations")
        before=(self.bridge.read_bytes(),self.tasks.read_bytes())
        result=module.preview(self.bridge,self.tasks)
        self.assertEqual((result["approved"],result["ready"],result["requires_project_mapping"]),(2,1,1))
        self.assertEqual(result["inserted"],0)
        self.assertNotIn("PRIVATE",str(result))
        self.assertEqual((self.bridge.read_bytes(),self.tasks.read_bytes()),before)

    def test_apply_requires_confirmation_and_existing_status(self):
        self.handoff("approved0001")
        original=self.task_rows()
        with self.assertRaisesRegex(ValueError,"confirmation"):
            self.apply(confirm="WRONG")
        with self.assertRaisesRegex(ValueError,"Unverified"):
            self.apply(status="made-up")
        self.assertEqual(self.task_rows(),original)
        self.assertEqual(list(self.backup_dir.iterdir()),[])

    def test_apply_creates_backup_inserts_and_is_idempotent(self):
        self.handoff("approved0001")
        self.handoff("project00002",project="Operations")
        initial=self.task_rows()
        first=self.apply()
        self.assertEqual(first["inserted"],1)
        self.assertEqual(first["requires_project_mapping"],1)
        backups=list(self.backup_dir.glob("*.sqlite3"))
        self.assertEqual(len(backups),1)
        self.assertEqual(backups[0].stat().st_mode & 0o777,0o600)
        with sqlite3.connect(backups[0]) as saved:
            self.assertEqual(saved.execute("SELECT COUNT(*) FROM tasks").fetchone()[0],len(initial))
        rows=self.task_rows()
        self.assertEqual(len(rows),2)
        imported=[row for row in rows if row[2]=="pixel-pals:approved0001"]
        self.assertEqual(len(imported),1)
        self.assertEqual(imported[0][3],"inbox")
        self.assertIsNone(imported[0][4])
        again=self.apply()
        self.assertEqual(again["inserted"],0)
        self.assertEqual(again["already_present"],1)
        self.assertEqual(len(list(self.backup_dir.glob("*.sqlite3"))),1)
        self.assertEqual(self.task_rows(),rows)

    def test_database_schema_and_duplicate_existing_source_fail_closed(self):
        self.handoff("approved0001")
        with sqlite3.connect(self.tasks) as db:
            db.execute("ALTER TABLE tasks RENAME COLUMN source TO old_source")
        with self.assertRaisesRegex(ValueError,"schema"):
            self.apply()
        self.assertEqual(list(self.backup_dir.iterdir()),[])

    def test_no_task_database_is_created(self):
        self.tasks.unlink()
        self.handoff("approved0001")
        with self.assertRaisesRegex(ValueError,"not found"):
            module.preview(self.bridge,self.tasks)
        self.assertFalse(self.tasks.exists())

    def test_atomic_rollback_on_database_constraint_failure(self):
        # A second insert fails, so even the first insert is not retained.
        with sqlite3.connect(self.tasks) as db:
            db.execute("CREATE UNIQUE INDEX uq_tasks_title ON tasks(title)")
        self.handoff("approved0001",title="Repeated title")
        self.handoff("approved0002",title="Repeated title")
        before=self.task_rows()
        with self.assertRaises(sqlite3.IntegrityError):
            self.apply()
        self.assertEqual(self.task_rows(),before)
        self.assertEqual(len(list(self.backup_dir.iterdir())),1)

    def test_cli_defaults_to_dry_run_and_no_private_content(self):
        self.handoff("approved0001")
        proc=subprocess.run([sys.executable,str(SOURCE),"--bridge-data-dir",str(self.root),
            "--adhd-data-dir",str(self.root)],capture_output=True,text=True)
        self.assertEqual(proc.returncode,0,proc.stderr)
        self.assertEqual(json.loads(proc.stdout)["inserted"],0)
        self.assertNotIn("PRIVATE",proc.stdout)
        self.assertEqual(len(self.task_rows()),1)


if __name__=="__main__":
    unittest.main()

#!/usr/bin/env python3
"""Tests rehearsal runner without mounting or reading any real app data."""
from __future__ import annotations

import json
import os
from pathlib import Path
import sqlite3
import subprocess
import sys
import tempfile
import unittest

HERE = Path(__file__).resolve().parent
sys.path.insert(0, str(HERE))
from stage_native_local_intake import run_rehearsal
from test_native_handoff_reconcile import FakeNativeStore


class DisposableStore(FakeNativeStore):
    """Use the real Store method contract but keep source/data synthetic."""
    def __init__(self, data_root: Path):
        super().__init__(data_root)
        self.native_bridge_enabled = False
        with self.connect() as db:
            db.execute("DELETE FROM peers")
        (data_root / "backups").mkdir(mode=0o700)

    def backup(self):
        path = self.path.parent / "backups" / "adhd-fixture.sqlite3"
        with self.connect() as db:
            with sqlite3.connect(path) as out:
                db.backup(out)
        self.backups += 1
        return str(path)


class NativeStagingTests(unittest.TestCase):
    def test_disposable_rehearsal_uses_native_api_and_deletes_fixtures(self):
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp) / "work"
            result = run_rehearsal(DisposableStore, scratch=root)
            self.assertEqual(result["result"], "PASS")
            self.assertTrue(result["backup_verified"])
            self.assertFalse(result["user_database_accessed"])
            self.assertFalse(result["native_peer_created"])
            self.assertFalse(result["live_deployment_authorized"])
            self.assertEqual(
                len(list((root / "native" / "backups").glob("adhd-*.sqlite3"))), 1
            )
            self.assertEqual(
                len(list((root / "bridge").glob("bridge-v02.sqlite3"))), 1
            )
        self.assertFalse(root.exists())

    def test_runner_refuses_without_explicit_staging_guard(self):
        env = {k: v for k, v in os.environ.items() if k != "ADHD_STAGING_ONLY"}
        proc = subprocess.run(
            [sys.executable, str(HERE / "stage_native_local_intake.py")],
            env=env, capture_output=True, text=True
        )
        self.assertEqual(proc.returncode, 2)
        self.assertIn("REFUSED", proc.stderr)
        self.assertNotIn("PRIVATE", proc.stderr)

    def test_tampered_native_schema_fails_before_task_creation(self):
        class BrokenStore(DisposableStore):
            def __init__(self, data_root: Path):
                super().__init__(data_root)
                with self.connect() as db:
                    db.execute("ALTER TABLE handoffs RENAME COLUMN peer_id TO old_peer")
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp) / "work"
            with self.assertRaisesRegex(ValueError, "Unsupported native ADHD"):
                run_rehearsal(BrokenStore, scratch=root)
            with sqlite3.connect(root / "native" / "adhd.sqlite3") as db:
                self.assertEqual(db.execute("SELECT COUNT(*) FROM tasks").fetchone()[0],0)


if __name__ == "__main__":
    unittest.main()

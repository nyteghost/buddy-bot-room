#!/usr/bin/env python3
"""Offline, disposable SQLite/source fixtures for native pairing readiness."""
from __future__ import annotations

import json
from pathlib import Path
import sqlite3
import subprocess
import sys
import tempfile
import unittest

from native_pairing_preflight import NATIVE_METHODS, inspect_native


class NativePreflightTests(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self.addCleanup(self.tmp.cleanup)
        self.root = Path(self.tmp.name)
        self.package = self.root / "adhd_assistant"
        self.package.mkdir()
        self.source = self.package / "database.py"
        self.source.write_text(
            "class Store:\n" +
            "".join("    def " + name + "(self, *args, **kwargs): pass\n"
                    for name in NATIVE_METHODS),
            encoding="utf-8",
        )
        self.dbpath = self.root / "adhd.sqlite3"
        with sqlite3.connect(self.dbpath) as db:
            db.executescript("""
            CREATE TABLE handoffs(id TEXT, direction TEXT, peer_id TEXT,
                kind TEXT, payload TEXT, state TEXT);
            CREATE TABLE tasks(id TEXT, title TEXT, notes TEXT, status TEXT,
                source TEXT);
            CREATE TABLE settings(key TEXT PRIMARY KEY, value TEXT);
            CREATE TABLE peers(id TEXT, enabled INTEGER, token TEXT);
            INSERT INTO peers VALUES('disabled-peer', 0, 'PRIVATE_TOKEN_DO_NOT_EXPOSE');
            INSERT INTO tasks VALUES('private-task', 'PRIVATE TITLE', 'PRIVATE NOTE',
                                     'open', 'manual');
            """)

    def test_disabled_native_bridge_and_zero_peers(self):
        before = self.dbpath.read_bytes()
        result = inspect_native(self.root, self.dbpath)
        self.assertTrue(result["native_schema_matches"])
        self.assertEqual(result["enabled_native_peer_count"], 0)
        self.assertFalse(result["native_bridge_enabled"])
        self.assertFalse(result["ready_for_staging"])
        self.assertFalse(result["live_task_creation_authorized"])
        self.assertEqual(set(result["blockers"]), {
            "native_bridge_disabled", "no_enabled_native_peer",
            "intended_native_peer_not_verified",
        })
        self.assertEqual(self.dbpath.read_bytes(), before)
        self.assertNotIn("PRIVATE", json.dumps(result))

    def test_enabled_pair_is_staging_ready_not_import_authorized(self):
        with sqlite3.connect(self.dbpath) as db:
            db.execute("INSERT INTO settings VALUES('bridge_enabled','on')")
            db.execute("UPDATE peers SET enabled=1")
        result = inspect_native(self.root, self.dbpath, expected_peer_id="disabled-peer")
        self.assertTrue(result["ready_for_staging"])
        self.assertTrue(result["intended_native_peer_enabled"])
        self.assertFalse(result["live_task_creation_authorized"])
        self.assertEqual(result["blockers"], [])
        self.assertNotIn("PRIVATE_TOKEN", json.dumps(result))

    def test_unrelated_enabled_peer_is_not_sufficient_for_staging(self):
        with sqlite3.connect(self.dbpath) as db:
            db.execute("INSERT INTO settings VALUES('bridge_enabled','on')")
            db.execute("UPDATE peers SET enabled=1")
        result = inspect_native(self.root, self.dbpath, expected_peer_id="pixelpals-peer")
        self.assertFalse(result["ready_for_staging"])
        self.assertFalse(result["intended_native_peer_enabled"])
        self.assertIn("intended_native_peer_not_verified", result["blockers"])
        self.assertEqual(result["enabled_native_peer_count"], 1)
        self.assertNotIn("disabled-peer", json.dumps(result))

    def test_unknown_bridge_setting_is_not_on(self):
        with sqlite3.connect(self.dbpath) as db:
            db.execute("INSERT INTO settings VALUES('bridge_enabled','OFF')")
            db.execute("UPDATE peers SET enabled=1")
        result = inspect_native(self.root, self.dbpath)
        self.assertFalse(result["native_bridge_enabled"])
        self.assertIn("native_bridge_disabled", result["blockers"])

    def test_unknown_schema_fails_readiness_without_modifying_data(self):
        with sqlite3.connect(self.dbpath) as db:
            db.execute("DROP TABLE handoffs")
        result = inspect_native(self.root, self.dbpath)
        self.assertFalse(result["native_schema_matches"])
        self.assertIn("native_schema_or_store_methods_unverified", result["blockers"])

    def test_missing_native_store_method_fails_readiness(self):
        self.source.write_text("class Store:\n    def connect(self): pass\n", encoding="utf-8")
        result = inspect_native(self.root, self.dbpath)
        self.assertFalse(result["native_store_methods_present"]["approve_handoff"])
        self.assertFalse(result["ready_for_staging"])

    def test_diagnostic_only_parses_never_executes_source(self):
        marker = self.root / "should-not-be-created"
        self.source.write_text(
            "from pathlib import Path\n"
            + "Path(" + repr(str(marker)) + ").write_text('bad')\n"
            + "class Store:\n"
            + "".join("    def " + name + "(self): pass\n" for name in NATIVE_METHODS),
            encoding="utf-8",
        )
        inspect_native(self.root, self.dbpath)
        self.assertFalse(marker.exists())

    def test_missing_database_refuses_without_creating_file(self):
        missing = self.root / "does-not-exist.sqlite3"
        with self.assertRaisesRegex(ValueError, "not found"):
            inspect_native(self.root, missing)
        self.assertFalse(missing.exists())

    def test_cli_output_does_not_include_tokens_or_task_text(self):
        proc = subprocess.run([
            sys.executable, str(Path(__file__).with_name("native_pairing_preflight.py")),
            "--source-root", str(self.root), "--database", str(self.dbpath)
        ], capture_output=True, text=True)
        self.assertEqual(proc.returncode, 0, proc.stderr)
        result = json.loads(proc.stdout)
        self.assertFalse(result["ready_for_staging"])
        self.assertNotIn("PRIVATE", proc.stdout)
        self.assertNotIn("private-task", proc.stdout)


if __name__ == "__main__":
    unittest.main()

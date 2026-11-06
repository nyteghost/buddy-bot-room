#!/usr/bin/env python3
"""Synthetic source tests: never edit installed ADHD-A or real databases."""
from __future__ import annotations

import importlib.util
import os
from pathlib import Path
import shutil
import tempfile
import unittest
from uuid import uuid4

HERE = Path(__file__).resolve().parent
spec = importlib.util.spec_from_file_location("prepare_patch", HERE / "prepare-native-review-patch.py")
assert spec and spec.loader
mod = importlib.util.module_from_spec(spec)
spec.loader.exec_module(mod)

SOURCE = """from urllib.parse import urlsplit

class NativeHTTPHandler:
    def _local(self):
        if not getattr(self, "authorized", False):
            raise PermissionError("Not an authorized local request")
    def _read(self):
        return {}
    def _bad(self, code, message):
        return None
    def do_GET(self):
        try:
            path=urlsplit(self.path).path
            if path == "/api/tasks":
                return self._json({"items":[]})
            self._local()
        except PermissionError:
            return self._bad(403, "Unauthorized")
        except ValueError:
            return self._bad(400, "Invalid")
    def do_POST(self):
        try:
            path=urlsplit(self.path).path
            if path == "/bridge/v1/messages":
                return self._json({"receipt":True})
            self._local()
            data=self._read()
            if path == "/api/task":
                return self._json({"id":"test"})
        except PermissionError:
            return self._bad(403, "Unauthorized")
        except ValueError:
            return self._bad(400, "Invalid")
"""


class PatchBuilderTests(unittest.TestCase):
    def setUp(self):
        self.dir = tempfile.TemporaryDirectory()
        self.addCleanup(self.dir.cleanup)
        self.root = Path(self.dir.name)
        source = self.root / "adhd_assistant"
        source.mkdir()
        self.server = source / "server.py"
        self.server.write_text(SOURCE, encoding="utf-8")

    def test_patch_preserves_existing_server_and_adds_four_review_routes(self):
        before = self.server.read_bytes()
        report = mod.prepare(self.root, HERE, None)
        self.assertEqual(report["result"], "compatible_source_layout")
        self.assertFalse(report["patch_changes_installed_app"])
        self.assertFalse(report["staging_prepared"])
        self.assertEqual(report["routes_prepared"], 4)
        self.assertEqual(self.server.read_bytes(), before)
        candidate = mod.patch_source(SOURCE)
        self.assertEqual(candidate.count("from native_review_http import"), 2)
        self.assertIn("handle_get", candidate)
        self.assertIn("handle_post", candidate)
        self.assertIn("page_dir=_PPIPath(__file__).resolve().parent.parent", candidate)
        self.assertIn('if path == "/api/task":', candidate)
        with self.assertRaisesRegex(ValueError, "already exist"):
            mod.patch_source(candidate)

    def test_unsafe_local_auth_refuses_instead_of_producing_patch(self):
        unsafe = SOURCE.replace(
            'raise PermissionError("Not an authorized local request")',
            'return False',
        )
        with self.assertRaisesRegex(ValueError, "authorization"):
            mod.patch_source(unsafe)
        self.assertNotIn("native_review_http", self.server.read_text())

    def test_route_parsing_has_to_match_native_server_convention(self):
        source = SOURCE.replace("path=urlsplit(self.path).path", "path=self.path")
        with self.assertRaisesRegex(ValueError, "route parsing"):
            mod.patch_source(source)

    def test_ambiguous_native_http_handler_fails_closed(self):
        with self.assertRaisesRegex(ValueError, "ambiguous"):
            mod.patch_source(SOURCE + "\n" + SOURCE.replace("NativeHTTPHandler", "AnotherHTTPHandler"))

    def test_temporary_staging_writes_only_to_new_tmp_folder(self):
        stage = Path("/tmp") / ("adhd-inbox-stage-" + uuid4().hex)
        try:
            result = mod.prepare(self.root, HERE, stage)
            self.assertTrue(result["staging_prepared"])
            self.assertTrue((stage / "adhd_assistant" / "server.py").is_file())
            for filename in mod.MODULES:
                self.assertTrue((stage / filename).is_file())
            self.assertNotEqual(
                (stage / "adhd_assistant" / "server.py").read_bytes(),
                self.server.read_bytes(),
            )
            self.assertEqual(self.server.read_bytes(), SOURCE.encode("utf-8"))
            self.assertFalse(result["native_bridge_settings_changed"])
            with self.assertRaisesRegex(ValueError, "new, nonexistent"):
                mod.prepare(self.root, HERE, stage)
        finally:
            shutil.rmtree(stage, ignore_errors=True)

    def test_no_staging_allowed_under_source_tree(self):
        stage = self.root / "stage"
        with self.assertRaisesRegex(ValueError, "/tmp"):
            mod.prepare(self.root, HERE, stage)
        self.assertFalse(stage.exists())


if __name__ == "__main__":
    unittest.main()

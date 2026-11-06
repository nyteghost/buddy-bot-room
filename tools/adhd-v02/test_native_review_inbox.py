#!/usr/bin/env python3
"""Offline regression tests for native in-app review action service."""
from __future__ import annotations

import json
from pathlib import Path
import sqlite3
import sys
import tempfile
import unittest

HERE = Path(__file__).resolve().parent
sys.path.insert(0, str(HERE))
from native_local_intake import CONFIRM as IMPORT_CONFIRM
from native_review_inbox import (
    APPROVE_CONFIRM, import_task, list_inbox, preview_import, review,
)
from test_native_local_intake import LocalIntakeTests


class InboxTests(LocalIntakeTests):
    # Reuse LocalIntakeTests' real-shaped SQLite fixture and safety regressions.
    # This also exercises the earlier importer's no-peer/no-network invariants.
    def test_reviewer_lists_pending_without_writing_to_database(self):
        self.handoff("pending000001",approved=False,event=False)
        before = self.bridge.read_bytes()
        result = list_inbox(self.bridge)
        self.assertEqual(result["pending_in_view"], 1)
        self.assertEqual(result["approved_in_view"], 0)
        self.assertEqual(result["items"][0]["title"], "PRIVATE TEST TASK")
        self.assertEqual(result["items"][0]["state"], "pending")
        self.assertEqual(self.bridge.read_bytes(), before)
        self.assertEqual(self.native_count("tasks"), 0)

    def test_review_is_a_separate_action_from_import(self):
        self.handoff("pending000001",approved=False,event=False)
        approved = review(self.bridge, handoff_id="pending000001",
                          decision="approve", owner_confirmation=APPROVE_CONFIRM)
        self.assertEqual(approved["state"], "approved")
        self.assertFalse(approved["already_reviewed"])
        self.assertEqual(self.native_count("tasks"), 0)
        plan = preview_import(self.bridge, self.store, handoff_id="pending000001")
        self.assertEqual(plan["native_state"], "unlinked")
        imported = import_task(self.bridge, self.store, handoff_id="pending000001",
                               owner_confirmation=IMPORT_CONFIRM)
        self.assertEqual(imported["outcome"], "linked")
        self.assertEqual(self.native_count("tasks"), 1)
        self.assertEqual(self.native_count("peers"), 0)
        self.assertFalse(self.store.native_bridge_enabled)

    def test_reject_is_final_and_cannot_turn_into_task(self):
        self.handoff("pending000001",approved=False,event=False)
        result = review(self.bridge, handoff_id="pending000001",
                        decision="reject", owner_confirmation=APPROVE_CONFIRM)
        self.assertEqual(result["state"], "rejected")
        with self.assertRaisesRegex(ValueError,"not been approved"):
            import_task(self.bridge,self.store,handoff_id="pending000001",
                        owner_confirmation=IMPORT_CONFIRM)
        with self.assertRaisesRegex(ValueError,"already reviewed"):
            review(self.bridge,handoff_id="pending000001",
                   decision="approve",owner_confirmation=APPROVE_CONFIRM)
        self.assertEqual(self.native_count("tasks"), 0)

    def test_duplicate_review_is_idempotent_and_audited_once(self):
        self.handoff("pending000001",approved=False,event=False)
        first = review(self.bridge, handoff_id="pending000001",
                       decision="approve", owner_confirmation=APPROVE_CONFIRM)
        second = review(self.bridge, handoff_id="pending000001",
                        decision="approve", owner_confirmation=APPROVE_CONFIRM)
        self.assertFalse(first["already_reviewed"])
        self.assertTrue(second["already_reviewed"])
        with sqlite3.connect(self.bridge) as db:
            n = db.execute("SELECT COUNT(*) FROM bridge_events WHERE handoff_id=? AND action='approve'",
                           ("pending000001",)).fetchone()[0]
        self.assertEqual(n,1)

    def test_confirmation_and_id_validation_block_side_effects(self):
        self.handoff("pending000001",approved=False,event=False)
        with self.assertRaisesRegex(ValueError,"confirmation"):
            review(self.bridge,handoff_id="pending000001",
                   decision="approve",owner_confirmation="no")
        with self.assertRaisesRegex(ValueError,"identifier"):
            review(self.bridge,handoff_id="'; DROP TABLE handoffs --",
                   decision="approve",owner_confirmation=APPROVE_CONFIRM)
        with self.assertRaisesRegex(ValueError,"Separate"):
            import_task(self.bridge,self.store,handoff_id="pending000001",
                        owner_confirmation="no")
        self.assertEqual(self.native_count("tasks"),0)
        self.assertEqual(list_inbox(self.bridge)["items"][0]["state"],"pending")

    def test_notes_do_not_enter_logs(self):
        self.handoff("pending000001",approved=False,event=False,notes="CONFIDENTIAL CONTENT")
        result=review(self.bridge,handoff_id="pending000001",
                      decision="approve",owner_confirmation=APPROVE_CONFIRM)
        self.assertNotIn("CONFIDENTIAL",str(result))
        task=import_task(self.bridge,self.store,handoff_id="pending000001",
                         owner_confirmation=IMPORT_CONFIRM)
        self.assertNotIn("CONFIDENTIAL",str(task))

    def test_review_does_not_create_database_if_missing(self):
        self.bridge.unlink()
        with self.assertRaisesRegex(ValueError,"unavailable"):
            list_inbox(self.bridge)
        self.assertFalse(self.bridge.exists())

    def test_inconsistent_bridge_schema_fails_closed(self):
        with sqlite3.connect(self.bridge) as db:
            db.execute("DROP TABLE bridge_events")
        with self.assertRaisesRegex(ValueError,"Unsupported bridge"):
            list_inbox(self.bridge)

    def test_owner_cannot_review_unknown_message_id(self):
        with self.assertRaisesRegex(ValueError,"Unknown handoff"):
            review(self.bridge,handoff_id="unknown001",
                   decision="approve",owner_confirmation=APPROVE_CONFIRM)


if __name__ == "__main__":
    unittest.main()

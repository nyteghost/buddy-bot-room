#!/usr/bin/env python3
"""No-network tests for staged existing-dashboard-only review routes."""
from __future__ import annotations

from io import BytesIO
import json
from pathlib import Path
import sqlite3
import sys
import tempfile
import unittest

HERE = Path(__file__).resolve().parent
sys.path.insert(0, str(HERE))

from native_review_http import API, PAGE, REVIEW, IMPORT, handle_get, handle_post
from test_native_local_intake import LocalIntakeTests


class MockHandler:
    def __init__(self, path, *, payload=None, origin="https://10.200.1.30:18765",
                 host="10.200.1.30:18765", site="same-origin"):
        self.path=path
        self.body=payload
        raw=json.dumps(payload if payload is not None else {}).encode("utf-8")
        self.headers={"Host":host, "Origin":origin, "Sec-Fetch-Site":site,
                      "Content-Type":"application/json","Content-Length":str(len(raw)),
                      "X-ADHD-Review":"1"}
        self.wfile=BytesIO()
        self.status=None
        self.response_headers={}
        self.auth_calls=0
        self.authorized=True

    def _local(self):
        self.auth_calls+=1
        if not self.authorized:
            raise PermissionError("Local authentication required")
    def _read(self):
        return self.body
    def send_response(self,status):
        self.status=status
    def send_header(self,name,value):
        self.response_headers[name]=value
    def end_headers(self):
        pass
    def response(self):
        return json.loads(self.wfile.getvalue())


class InboxHttpTests(LocalIntakeTests):
    def test_get_page_includes_csp_and_no_remote_fetch(self):
        handler=MockHandler(PAGE)
        self.assertTrue(handle_get(handler,bridge_db=self.bridge,page_dir=HERE))
        html=handler.wfile.getvalue().decode("utf-8")
        self.assertEqual(handler.status,200)
        self.assertEqual(handler.auth_calls,1)
        self.assertIn("Pixel Pals handoff inbox", html)
        self.assertIn("script-src 'sha256-",handler.response_headers["Content-Security-Policy"])
        self.assertIn("connect-src 'self'",handler.response_headers["Content-Security-Policy"])
        self.assertEqual(handler.response_headers["Cache-Control"],"no-store, private")
        self.assertIn("textContent=",html)
        self.assertNotIn("innerHTML",html)

    def test_list_is_auth_guarded_and_includes_no_peer_token(self):
        self.handoff("pending000001",approved=False,event=False)
        handler=MockHandler(API)
        self.assertTrue(handle_get(handler,bridge_db=self.bridge,page_dir=HERE))
        self.assertEqual(handler.response()["pending_in_view"],1)
        self.assertNotIn("token",handler.wfile.getvalue().decode("utf-8"))
        self.assertEqual(handler.auth_calls,1)
        blocked=MockHandler(API)
        blocked.authorized=False
        with self.assertRaises(PermissionError):
            handle_get(blocked,bridge_db=self.bridge,page_dir=HERE)
        self.assertEqual(blocked.wfile.getvalue(),b"")

    def test_approval_then_native_task_import_is_separate_and_owner_only(self):
        self.handoff("pending000001",approved=False,event=False)
        request=MockHandler(REVIEW,payload={"id":"pending000001","decision":"approve"})
        self.assertTrue(handle_post(request,bridge_db=self.bridge,store=self.store))
        self.assertEqual(request.response()["state"],"approved")
        self.assertEqual(request.auth_calls,1)
        self.assertEqual(self.native_count("tasks"),0)
        imported=MockHandler(IMPORT,payload={"id":"pending000001"})
        self.assertTrue(handle_post(imported,bridge_db=self.bridge,store=self.store))
        self.assertEqual(imported.response()["outcome"],"linked")
        self.assertEqual(self.native_count("tasks"),1)
        self.assertEqual(self.native_count("peers"),0)
        self.assertFalse(self.store.native_bridge_enabled)
        second=MockHandler(IMPORT,payload={"id":"pending000001"})
        handle_post(second,bridge_db=self.bridge,store=self.store)
        self.assertEqual(second.response()["outcome"],"already-linked")
        self.assertEqual(self.native_count("tasks"),1)

    def test_cross_site_post_rejected_before_review(self):
        self.handoff("pending000001",approved=False,event=False)
        handler=MockHandler(REVIEW,payload={"id":"pending000001","decision":"approve"},
                            origin="https://malicious.example",site="cross-site")
        with self.assertRaises(PermissionError):
            handle_post(handler,bridge_db=self.bridge,store=self.store)
        self.assertEqual(self.native_count("tasks"),0)
        with sqlite3.connect(self.bridge) as db:
            state=db.execute("SELECT state FROM handoffs").fetchone()[0]
        self.assertEqual(state,"pending")

    def test_custom_header_and_content_type_required(self):
        self.handoff("pending000001",approved=False,event=False)
        h=MockHandler(REVIEW,payload={"id":"pending000001","decision":"approve"})
        h.headers.pop("X-ADHD-Review")
        with self.assertRaises(PermissionError):
            handle_post(h,bridge_db=self.bridge,store=self.store)
        h=MockHandler(REVIEW,payload={"id":"pending000001","decision":"approve"})
        h.headers["Content-Type"]="text/plain"
        with self.assertRaisesRegex(ValueError,"JSON"):
            handle_post(h,bridge_db=self.bridge,store=self.store)

    def test_route_rejects_extra_fields_and_invalid_source(self):
        self.handoff("pending000001",approved=False,event=False)
        h=MockHandler(REVIEW,payload={"id":"pending000001","decision":"approve","extra":"bad"})
        with self.assertRaisesRegex(ValueError,"Unexpected"):
            handle_post(h,bridge_db=self.bridge,store=self.store)
        h=MockHandler(REVIEW+"?id=pending000001",payload={"id":"pending000001","decision":"approve"})
        with self.assertRaisesRegex(ValueError,"query"):
            handle_post(h,bridge_db=self.bridge,store=self.store)
        self.assertEqual(self.native_count("tasks"),0)

    def test_unknown_routes_are_not_consumed(self):
        h=MockHandler("/api/memory")
        self.assertFalse(handle_get(h,bridge_db=self.bridge,page_dir=HERE))
        self.assertFalse(handle_post(h,bridge_db=self.bridge,store=self.store))
        self.assertEqual(h.auth_calls,0)

    def test_unauthorized_client_can_never_create_task(self):
        self.handoff("pending000001",approved=True,event=True)
        h=MockHandler(IMPORT,payload={"id":"pending000001"})
        h.authorized=False
        with self.assertRaises(PermissionError):
            handle_post(h,bridge_db=self.bridge,store=self.store)
        self.assertEqual(self.native_count("tasks"),0)


if __name__ == "__main__":
    unittest.main()

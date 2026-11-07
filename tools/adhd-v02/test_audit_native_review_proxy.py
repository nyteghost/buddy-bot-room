#!/usr/bin/env python3
"""Synthetic, no-network Caddy route security audit regression tests."""
from __future__ import annotations

import json
from io import StringIO
import unittest
from unittest.mock import patch

from audit_native_review_proxy import PATHS, audit, main

HOST = "private.example"
HASH = "$2a$12$TOP-SECRET-DUMMY-HASH"
TOKEN = "VERY-PRIVATE-DUMMY-TOKEN"


def config(*, auth=True, host_rewrite=True, origin_rewrite=True,
           inject_token=False, route_path=None, order=None):
    auth_handler = {"handler": "authentication", "providers": {
        "http_basic": {"accounts": [
            {"username": "private-user", "password": HASH}]}}}
    headers = {}
    if host_rewrite:
        headers["Host"] = ["127.0.0.1:8765"]
    if origin_rewrite:
        headers["Origin"] = ["http://127.0.0.1:8765"]
    if inject_token:
        headers["X-ADHD-Local-Token"] = [TOKEN]
    proxy = {"handler": "reverse_proxy",
             "upstreams": [{"dial": "127.0.0.1:8765"}],
             "headers": {"request": {"set": headers}}}
    handlers = [auth_handler, proxy] if auth else [proxy]
    if order == "proxy-first":
        handlers.reverse()
    route = {"handle": handlers}
    if route_path is not None:
        route["match"] = [{"path": [route_path]}]
    return {"apps": {"http": {"servers": {"srv0": {
        "routes": [{"match": [{"host": [HOST]}],
                    "handle": [{"handler": "subroute",
                                "routes": [route]}]}]}}}}}


class ProxyAuditTests(unittest.TestCase):
    def check_all(self, report, field, expected):
        for path in PATHS:
            self.assertIs(report["paths"][path][field], expected, path)

    def test_no_token_header_is_not_ready(self):
        result = audit(config(), HOST)
        self.check_all(result, "basic_auth_before_proxy", True)
        self.check_all(result, "native_token_header_injection_present", False)
        self.check_all(result, "route_structure_unambiguous", True)
        self.assertFalse(result["live_installation_authorized"])

    def test_synthetic_complete_stack_still_not_approved(self):
        result = audit(config(inject_token=True), HOST)
        for key in ("basic_auth_before_proxy", "native_loopback_upstream",
                    "host_rewrite_present", "origin_rewrite_present",
                    "native_token_header_injection_present"):
            self.check_all(result, key, True)
        self.assertFalse(result["actual_browser_request_tested"])
        self.assertFalse(result["native_token_value_verified"])
        self.assertFalse(result["live_installation_authorized"])

    def test_missing_auth_fails(self):
        self.check_all(audit(config(auth=False, inject_token=True), HOST),
                       "basic_auth_before_proxy", False)

    def test_auth_after_proxy_is_not_protection(self):
        self.check_all(audit(config(inject_token=True, order="proxy-first"), HOST),
                       "basic_auth_before_proxy", False)

    def test_wrong_upstream_is_not_native_dashboard(self):
        conf = config(inject_token=True)
        proxy = conf["apps"]["http"]["servers"]["srv0"]["routes"][0]["handle"][0]["routes"][0]["handle"][-1]
        proxy["upstreams"][0]["dial"] = "malicious.example:8765"
        self.check_all(audit(conf, HOST), "native_loopback_upstream", False)

    def test_missing_host_origin_rewrites_fail(self):
        report = audit(config(host_rewrite=False, origin_rewrite=False,
                              inject_token=True), HOST)
        self.check_all(report, "host_rewrite_present", False)
        self.check_all(report, "origin_rewrite_present", False)

    def test_only_first_path_exposed(self):
        report = audit(config(route_path="/pixel-pals-inbox", inject_token=True), HOST)
        self.assertEqual(report["paths"][PATHS[0]]["candidate_upstreams"], 1)
        for path in PATHS[1:]:
            self.assertEqual(report["paths"][path]["candidate_upstreams"], 0)

    def test_wrong_host_is_not_treated_as_covered(self):
        result = audit(config(inject_token=True), "elsewhere.example")
        for path in PATHS:
            self.assertEqual(result["paths"][path]["candidate_upstreams"], 0)

    def test_nonmatching_host_reports_possible_mismatch_without_leaking_host(self):
        conf = config(inject_token=True)
        report = audit(conf, "different-private.example")
        self.assertEqual(report["status"], "unverified_no_matching_route")
        self.assertFalse(report["route_coverage_verified"])
        for item in report["paths"].values():
            self.assertEqual(item["candidate_upstreams"], 0)
            self.assertEqual(item["any_host_proxy_route_candidates"], 1)
            self.assertTrue(item["potential_hostname_mismatch"])
        output = json.dumps(report)
        self.assertNotIn(HOST, output)
        self.assertNotIn(TOKEN, output)
        self.assertNotIn(HASH, output)

    def test_cli_exits_nonzero_when_no_route_matches_requested_host(self):
        source = json.dumps(config(inject_token=True))
        out, err = StringIO(), StringIO()
        with patch("sys.stdin", StringIO(source)), patch("sys.stdout", out), patch("sys.stderr", err):
            self.assertEqual(main(["--host", "not-the-browser-host.example"]), 3)
        data = json.loads(out.getvalue())
        self.assertFalse(data["route_coverage_verified"])
        self.assertNotIn(HOST, out.getvalue() + err.getvalue())

    def test_no_proxy_candidates_at_any_host_is_inconclusive(self):
        conf = config(inject_token=True)
        conf["apps"]["http"]["servers"]["srv0"]["routes"] = []
        report = audit(conf, HOST)
        self.assertFalse(report["route_coverage_verified"])
        for item in report["paths"].values():
            self.assertEqual(item["candidate_upstreams"], 0)
            self.assertEqual(item["any_host_proxy_route_candidates"], 0)
            self.assertFalse(item["potential_hostname_mismatch"])

    def test_unknown_matcher_is_ambiguous(self):
        conf = config(inject_token=True)
        conf["apps"]["http"]["servers"]["srv0"]["routes"][0]["match"] = [
            {"expression": "foo()"}]
        self.check_all(audit(conf, HOST), "route_structure_unambiguous", False)

    def test_extra_proxy_without_auth_fails_closed(self):
        conf = config(inject_token=True)
        conf["apps"]["http"]["servers"]["srv0"]["routes"].append(
            {"handle": [{"handler": "reverse_proxy",
                         "upstreams": [{"dial": "x"}]}]})
        result = audit(conf, HOST)
        self.check_all(result, "basic_auth_before_proxy", False)
        self.check_all(result, "route_structure_unambiguous", False)

    def test_unknown_host_matcher_is_not_verified_route_coverage(self):
        conf = config(inject_token=True)
        conf["apps"]["http"]["servers"]["srv0"]["routes"][0]["match"] = [
            {"expression": "unsupported_secret_expression()"}]
        report = audit(conf, HOST)
        self.check_all(report, "candidate_upstreams", 1)
        self.check_all(report, "ambiguous_match_candidates", 1)
        self.check_all(report, "certain_upstream_candidates", 0)
        self.assertFalse(report["route_coverage_verified"])
        self.assertFalse(report["static_control_markers_complete"])
        self.assertEqual(report["status"], "unverified_ambiguous_routes")

    def test_known_or_unknown_matchers_still_fail_closed(self):
        conf = config(inject_token=True)
        conf["apps"]["http"]["servers"]["srv0"]["routes"][0]["match"] = [
            {"host": [HOST]}, {"expression": "unsupported_match()"}]
        report = audit(conf, HOST)
        self.assertFalse(report["route_coverage_verified"])
        self.check_all(report, "route_structure_unambiguous", False)

    def test_two_complete_routes_cannot_masquerade_as_single_safe_route(self):
        import copy
        conf = config(inject_token=True)
        routes = conf["apps"]["http"]["servers"]["srv0"]["routes"]
        routes.append(copy.deepcopy(routes[0]))
        report = audit(conf, HOST)
        self.check_all(report, "candidate_upstreams", 2)
        self.assertFalse(report["route_coverage_verified"])
        self.assertFalse(report["static_control_markers_complete"])

    def test_cli_returns_check_when_token_marker_missing(self):
        out, err = StringIO(), StringIO()
        with patch("sys.stdin", StringIO(json.dumps(config()))),  patch("sys.stdout", out), patch("sys.stderr", err):
            self.assertEqual(main(["--host", HOST]), 3)
        report = json.loads(out.getvalue())
        self.assertTrue(report["route_coverage_verified"])
        self.assertFalse(report["static_control_markers_complete"])
        self.assertEqual(report["status"], "unverified_missing_security_controls")
        self.assertNotIn(HOST, out.getvalue() + err.getvalue())

    def test_cli_complete_static_markers_do_not_authorize_install(self):
        out, err = StringIO(), StringIO()
        with patch("sys.stdin", StringIO(json.dumps(config(inject_token=True)))),  patch("sys.stdout", out), patch("sys.stderr", err):
            self.assertEqual(main(["--host", HOST]), 0)
        report = json.loads(out.getvalue())
        self.assertTrue(report["static_control_markers_complete"])
        self.assertFalse(report["actual_browser_request_tested"])
        self.assertFalse(report["live_installation_authorized"])

    def test_stdout_never_contains_private_config_values(self):
        source = json.dumps(config(inject_token=True))
        out, err = StringIO(), StringIO()
        with patch("sys.stdin", StringIO(source)), patch("sys.stdout", out), patch("sys.stderr", err):
            self.assertEqual(main(["--host", HOST]), 0)
        content = out.getvalue() + err.getvalue()
        for secret in (HASH, TOKEN, HOST, "private-user", "127.0.0.1:8765"):
            self.assertNotIn(secret, content)

    def test_invalid_configuration_is_generic_error(self):
        out, err = StringIO(), StringIO()
        with patch("sys.stdin", StringIO('{"password":"secret"')), \
             patch("sys.stdout", out), patch("sys.stderr", err):
            self.assertEqual(main(["--host", HOST]), 1)
        self.assertNotIn("secret", out.getvalue() + err.getvalue())


if __name__ == "__main__":
    unittest.main()

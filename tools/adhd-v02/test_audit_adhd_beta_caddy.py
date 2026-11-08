"""Synthetic tests for redacted live Caddy audit; no actual certificates or appdata."""
import importlib.util
import io
import json
from pathlib import Path
import unittest
from contextlib import redirect_stdout

PATH=Path(__file__).with_name("audit-adhd-beta-caddy.py")
spec=importlib.util.spec_from_file_location("caddy_audit", PATH)
mod=importlib.util.module_from_spec(spec)
spec.loader.exec_module(mod)


def sample(*, auth=True, target="127.0.0.1:8765", nested=False):
    proxy={
        "handler": "reverse_proxy",
        "upstreams": [{"dial": target}],
        "headers": {"request": {"set": {
            "Host": ["127.0.0.1:8765"],
            "Origin": ["http://127.0.0.1:8765"],
            "X-ADHD-Local-Token": ["NEVER_PRINT_THIS_SECRET"],
        }}},
    }
    handlers=([{"handler":"authentication","providers":{
        "http_basic":{"accounts":[{"username":"PRIVATE_USER",
                                     "password":"NEVER_PRINT_THIS_HASH"}]}}}] if auth else [])
    handlers.append(proxy)
    if nested:
        handlers=[{"handler":"subroute","routes":[{"handle":handlers}]}]
    return {"apps":{"http":{"servers":{"srv0":{
        "listen":[":18765"],"tls_connection_policies":[{}],
        "routes":[{"handle":handlers,"match":[{"host":["PRIVATE_DOMAIN"]}]}]
    }}}}}


class CaddyBetaAuditTests(unittest.TestCase):
    def test_protected_native_upstream_has_no_secret_disclosure(self):
        report=mod.inspect(sample())
        out=json.dumps(report)
        self.assertEqual(report["production_adhd_loopback_routes"],1)
        self.assertEqual(report["production_adhd_routes_with_basic_auth_before_proxy"],1)
        self.assertEqual(report["production_adhd_host_rewrite_routes"],1)
        self.assertEqual(report["production_adhd_origin_rewrite_routes"],1)
        self.assertTrue(report["production_adhd_proxy_token_header_present"])
        self.assertIn("existing_18765",report["listener_classes"])
        self.assertFalse(report["browser_https_auth_verified"])
        for secret in ("NEVER_PRINT_THIS_SECRET","NEVER_PRINT_THIS_HASH",
                       "PRIVATE_DOMAIN","PRIVATE_USER"):
            self.assertNotIn(secret,out)

    def test_no_auth_is_reported_not_assumed(self):
        report=mod.inspect(sample(auth=False))
        self.assertEqual(report["production_adhd_routes_with_basic_auth_before_proxy"],0)
        self.assertEqual(report["production_adhd_loopback_routes"],1)

    def test_nested_proxy_and_beta_classification(self):
        report=mod.inspect(sample(target="127.0.0.1:18767",nested=True))
        self.assertEqual(report["photo_beta_loopback_routes"],1)
        self.assertEqual(report["photo_beta_routes_with_basic_auth_before_proxy"],1)
        self.assertEqual(report["production_adhd_loopback_routes"],0)

    def test_other_proxy_and_unknown_handler_are_not_claimed_secure(self):
        x=sample(target="192.168.1.20:8888")
        x["apps"]["http"]["servers"]["srv0"]["routes"][0]["handle"].append({
            "handler":"custom_plugin","unknown":True})
        report=mod.inspect(x)
        self.assertEqual(report["other_proxy_routes"],1)
        self.assertTrue(report["unrecognized_route_features"])
        self.assertEqual(report["production_adhd_loopback_routes"],0)

    def test_bad_config_rejected(self):
        for cfg in (None, {}, {"apps":{"http":{"servers":[]}}}):
            with self.subTest(cfg=cfg), self.assertRaises(ValueError):
                mod.inspect(cfg)


if __name__=="__main__":
    unittest.main()

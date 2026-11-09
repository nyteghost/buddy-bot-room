"""Static safety checks for opt-in independent photo beta HTTPS gateway.

Complements (does not replace) actual Caddy validation and real-device tests.
No network, Docker daemon, credentials or appdata are touched.
"""
from pathlib import Path
import re
import unittest

ROOT = Path(__file__).parent
INSTALLER = (ROOT / "install-adhd-photo-independent-gateway.sh").read_text()
OVERLAY = (ROOT / "photo-beta-independent-gateway.yml").read_text()


class GatewaySafetyTest(unittest.TestCase):
    def test_single_service_target_and_no_full_stack_commands(self):
        self.assertIn("adhd-assistant-photo-gateway", INSTALLER)
        self.assertIn("up -d --no-deps --pull never", INSTALLER)
        self.assertNotRegex(INSTALLER, r"docker compose[^\n]* down\b")
        self.assertNotIn("--remove-orphans", INSTALLER)
        self.assertNotRegex(INSTALLER, r"docker (?:restart|stop) ")
        self.assertNotIn("caddy reload", INSTALLER.lower())

    def test_new_gateway_has_distinct_data_and_no_public_http(self):
        self.assertIn('profiles: ["adhd-photo-beta"]', OVERLAY)
        self.assertIn("network_mode: host", OVERLAY)
        self.assertIn('read_only: true', OVERLAY)
        self.assertIn("no-new-privileges", OVERLAY)
        self.assertIn("ADHD_PHOTO_GATEWAY_DATA", OVERLAY)
        self.assertIn("ADHD_PHOTO_GATEWAY_CONF", OVERLAY)
        self.assertNotIn("/mnt/user/appdata/adhd-assistant/data", OVERLAY)
        self.assertNotIn("ports:", OVERLAY)

    def test_auth_first_and_no_extra_admin_listener(self):
        self.assertIn("admin off", INSTALLER)
        self.assertIn("auto_https disable_redirects", INSTALLER)
        self.assertIn("bind 10.200.1.30", INSTALLER)
        self.assertIn("tls internal", INSTALLER)
        self.assertIn("basic_auth", INSTALLER)
        self.assertIn("header_up Host 127.0.0.1:18767", INSTALLER)
        self.assertIn("header_up Origin http://127.0.0.1:18767", INSTALLER)
        self.assertIn("respond @denyBridge 404", INSTALLER)
        self.assertLess(INSTALLER.index("basic_auth"), INSTALLER.index("respond @denyBridge"))
        self.assertLess(INSTALLER.index("respond @denyBridge"), INSTALLER.index("reverse_proxy http://127.0.0.1:18767"))
        self.assertNotIn("0.0.0.0:18767", INSTALLER)

    def test_preflight_and_authentication_check_present(self):
        self.assertIn("PROD_CADDY_DIR", INSTALLER)
        self.assertIn("cmp -s", INSTALLER)
        self.assertIn("validate --config", INSTALLER)
        self.assertIn("--tmpfs /tmp:rw,nosuid,nodev,size=16m,mode=1777", INSTALLER)
        self.assertIn("--tmpfs /data:rw,nosuid,nodev,size=16m,uid=99,gid=100,mode=0700", INSTALLER)
        self.assertIn("--tmpfs /config:rw,nosuid,nodev,size=16m,uid=99,gid=100,mode=0700", INSTALLER)
        self.assertIn("--env HOME=/tmp", INSTALLER)
        self.assertIn('INSTALL INDEPENDENT BETA GATEWAY', INSTALLER)
        self.assertIn("STATUS", INSTALLER)
        self.assertIn("401", INSTALLER)


if __name__ == "__main__":
    unittest.main()

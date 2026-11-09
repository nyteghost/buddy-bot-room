"""Synthetic static regression for ADHD tailnet beta route safety."""
from pathlib import Path
import unittest

SCRIPT=(Path(__file__).parent/"install-adhd-photo-tailnet-serve.sh").read_text()

class TailnetBetaSafety(unittest.TestCase):
    def test_preserves_existing_pixel_pals_serve(self):
        self.assertIn("http://127.0.0.1:8090", SCRIPT)
        self.assertIn(":8443", SCRIPT)
        self.assertIn("--https=8444", SCRIPT)
        self.assertIn("http://127.0.0.1:18769", SCRIPT)
        self.assertNotIn("tailscale serve reset\n", SCRIPT)
        self.assertNotIn("tailscale funnel ", SCRIPT)
        self.assertNotIn("--https=8443 off", SCRIPT)

    def test_auth_gate_and_no_direct_beta_exposure(self):
        self.assertIn("bind 127.0.0.1", SCRIPT)
        self.assertIn("basic_auth", SCRIPT)
        self.assertIn("header_up -Authorization", SCRIPT)
        self.assertIn("https://tower.tarpon-drum.ts.net:8444", SCRIPT)
        self.assertIn("not header Origin https://tower.tarpon-drum.ts.net:8444", SCRIPT)
        self.assertLess(SCRIPT.index("basic_auth {"), SCRIPT.index("respond @denyBridge 404"))
        self.assertLess(SCRIPT.index("respond @denyBridge 404"), SCRIPT.index("reverse_proxy http://127.0.0.1:18767"))
        self.assertNotIn("0.0.0.0:18767", SCRIPT)

    def test_only_beta_gateway_can_restart(self):
        self.assertIn("PROXY=adhd-assistant-photo-gateway", SCRIPT)
        self.assertIn('docker restart "$PROXY"', SCRIPT)
        self.assertNotIn("docker compose down", SCRIPT)
        self.assertNotIn("docker restart adhd-assistant-lan", SCRIPT)
        self.assertNotIn("docker stop adhd-assistant-lan", SCRIPT)
        self.assertIn("ADD ADHD TAILNET BETA", SCRIPT)

    def test_guarded_candidate_and_rollback(self):
        self.assertIn("--network none --read-only", SCRIPT)
        self.assertIn("uid=99,gid=100,mode=0700", SCRIPT)
        self.assertIn('curl -sS --cacert "$CA"', SCRIPT)
        self.assertIn("STATUS", SCRIPT)
        self.assertIn("401", SCRIPT)
        self.assertIn("--https=8444 off", SCRIPT)
        self.assertIn("BACKUP=", SCRIPT)

if __name__ == "__main__":
    unittest.main()

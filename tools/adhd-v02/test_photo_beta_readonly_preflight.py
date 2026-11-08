"""Fully synthetic read-only Unraid preflight regression tests.

External Docker, socket and Ollama commands are isolated fixture stubs. Tests
never contact a real Unraid host, Docker daemon or gaming-PC IP address.
"""
import os
from pathlib import Path
import subprocess
import tempfile
import unittest


SCRIPT = Path(__file__).with_name("photo-beta-readonly-preflight.sh")

DOCKER_STUB = r'''#!/usr/bin/env python3
import sys
a=sys.argv[1:]
existing=("buddy-bot-room","adhd-assistant","adhd-assistant-bridge")
if a[:2] == ["container","inspect"]:
    sys.exit(0 if len(a)>2 and a[2] in existing else 1)
if a and a[0] == "inspect":
    fmt=a[2] if len(a)>2 else ""
    if "com.docker.compose.project.working_dir" in fmt:
        print("/boot/config/plugins/compose.manager/projects/pixelpals")
    elif "com.docker.compose.project.config_files" in fmt:
        print("/boot/config/plugins/compose.manager/projects/pixelpals/docker-compose.yml,/boot/config/plugins/compose.manager/projects/pixelpals/docker-compose.override.yml")
    elif "com.docker.compose.project" in fmt:
        print("pixelpals")
    elif "com.docker.compose.service" in fmt:
        print("buddy-bot" if a[-1] == "buddy-bot-room" else "adhd-assistant")
    elif ".State.Status" in fmt:
        print("running")
    elif ".State.Health" in fmt:
        print("healthy")
    else:
        sys.exit(2)
    sys.exit(0)
sys.exit(2)
'''

SS_STUB = r'''#!/usr/bin/env python3
import os, sys
if os.environ.get("SIMULATE_SS_ERROR") == "1":
    sys.exit(2)
if os.environ.get("SIMULATE_PORT_IN_USE") == "1":
    print("LISTEN 0 64 127.0.0.1:18765 0.0.0.0:*")
else:
    print("LISTEN 0 64 127.0.0.1:8765 0.0.0.0:*")
'''

CURL_STUB = r'''#!/usr/bin/env python3
import sys
if "http://10.200.1.149:11434/api/tags" not in sys.argv:
    sys.exit(2)
print('{"models":[{"name":"qwen3-vl:4b"}]}')
'''


class ReadOnlyPreflightRegression(unittest.TestCase):
    def run_fake_preflight(self, *, occupied=False, ss_error=False):
        with tempfile.TemporaryDirectory() as td:
            path = Path(td)
            for name, src in (("docker", DOCKER_STUB), ("ss", SS_STUB), ("curl", CURL_STUB)):
                target = path / name
                target.write_text(src)
                target.chmod(0o755)
            env = dict(os.environ)
            env.update(
                PATH=str(path) + os.pathsep + os.environ.get("PATH", ""),
                SIMULATE_PORT_IN_USE="1" if occupied else "0",
                SIMULATE_SS_ERROR="1" if ss_error else "0",
            )
            return subprocess.run(
                ["bash", str(SCRIPT)], env=env, text=True,
                capture_output=True, timeout=8, check=False,
            )

    def test_free_port_passes_static_preflight(self):
        result = self.run_fake_preflight()
        self.assertEqual(result.returncode, 0, result.stderr + result.stdout)
        self.assertIn("STATIC PREFLIGHT PASSED", result.stdout)
        self.assertIn("no listener shown by ss", result.stdout)
        self.assertNotIn("port 18765 is already listening", result.stdout)

    def test_occupied_port_fails_and_never_reports_free(self):
        result = self.run_fake_preflight(occupied=True)
        self.assertEqual(result.returncode, 1, result.stderr + result.stdout)
        self.assertIn("port 18765 is already listening", result.stdout)
        self.assertNotIn("no listener shown by ss", result.stdout)
        self.assertIn("PREFLIGHT INCOMPLETE", result.stdout)
        self.assertNotIn("STATIC PREFLIGHT PASSED", result.stdout)

    def test_socket_inspection_failure_does_not_pass(self):
        result = self.run_fake_preflight(ss_error=True)
        self.assertEqual(result.returncode, 1, result.stderr + result.stdout)
        self.assertIn("ss failed to inspect", result.stdout)
        self.assertNotIn("no listener shown by ss", result.stdout)
        self.assertNotIn("STATIC PREFLIGHT PASSED", result.stdout)


if __name__ == "__main__":
    unittest.main()

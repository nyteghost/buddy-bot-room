#!/usr/bin/env python3
"""Regression: curl | bash must reach all six diagnostic stages.

Runs script text through bash stdin with mocked Docker/curl, so a Docker
command that reads the stream before stage 6 will consume the remaining
script and fail this test. No network, containers, credentials or live data.
"""
from __future__ import annotations

import os
from pathlib import Path
import subprocess
import tempfile
import unittest

HERE = Path(__file__).resolve().parent
SCRIPT = HERE / "run-complete-readonly-diagnostics.sh"

MOCK_DOCKER = r"""#!/usr/bin/env bash
set -e
case "$1" in
  inspect)
    case " $* " in
      *".State.Status"*) printf 'running\n' ;;
      *".State.Health"*) printf 'healthy\n' ;;
    esac ;;
  image) exit 0 ;;
  exec)
    # Simulate the caddy adapter output; never contain secrets in fixture.
    printf '{"apps":{"http":{"servers":{}}}}\n' ;;
  run)
    # Docker's -i mode drains stdin, even for an offline Python preflight.
    # The previous bug consumed the remainder of the piped shell script.
    for arg in "$@"; do
      if [ "$arg" = "-i" ]; then cat >/dev/null; break; fi
    done
    printf '{"synthetic_test":true}\n' ;;
  *) exit 6 ;;
esac
"""
MOCK_CURL = r"""#!/usr/bin/env bash
set -e
previous=''
target=''
for arg in "$@"; do
  if [ "$previous" = '--output' ]; then target="$arg"; break; fi
  previous="$arg"
done
if [ -z "$target" ]; then exit 7; fi
printf '# synthetic source; never executed by mocked Docker\n' > "$target"
"""

class PipedDiagnosticTests(unittest.TestCase):
    def test_all_six_sections_execute_from_piped_bash_stdin(self):
        with tempfile.TemporaryDirectory(prefix="adhd-pipe-fixture-") as td:
            root = Path(td)
            bin_dir = root / "bin"
            bin_dir.mkdir()
            for name, source in (("docker", MOCK_DOCKER), ("curl", MOCK_CURL)):
                binary = bin_dir / name
                binary.write_text(source, encoding="utf-8")
                binary.chmod(0o755)
            app = root / "app" / "adhd_assistant"
            app.mkdir(parents=True)
            for name in ("server.py", "database.py"):
                (app / name).write_text("# synthetic installed file\n", encoding="utf-8")
            env = dict(os.environ)
            env["PATH"] = str(bin_dir) + os.pathsep + env.get("PATH", "")
            env["ADHD_AUDIT_CODE_ROOT"] = str(root / "app")
            env["ADHD_AUDIT_HOST"] = "test.invalid"
            result = subprocess.run(
                ["bash"], input=SCRIPT.read_text(encoding="utf-8"),
                text=True, capture_output=True, env=env, timeout=20,
                check=False,
            )
        self.assertEqual(result.returncode, 0, result.stderr + result.stdout)
        for section in range(1, 7):
            self.assertIn("=== " + str(section) + ".", result.stdout)
        self.assertIn("=== Summary ===", result.stdout)
        self.assertIn("Live deployment authorized: NO", result.stdout)
        self.assertIn("Existing applications, Caddy settings, and user data: NOT MODIFIED", result.stdout)
        self.assertNotIn("REFUSED", result.stdout)

    def test_caddy_pipe_is_the_only_diagnostic_stdin_consumer(self):
        src = SCRIPT.read_text(encoding="utf-8")
        self.assertIn("--source-root /opt/adhd </dev/null", src)
        self.assertIn("test_native_review_http test_native_review_inbox </dev/null", src)
        self.assertIn("python -B /checks/stage_native_local_intake.py </dev/null", src)
        # The adapted Caddy JSON must continue to flow into the parser.
        self.assertIn('| isolated python -B /checks/audit_native_review_proxy.py', src)

if __name__ == "__main__":
    unittest.main()

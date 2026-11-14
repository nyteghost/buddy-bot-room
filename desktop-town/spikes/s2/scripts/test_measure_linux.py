#!/usr/bin/env python3
"""Unit regressions for S2 /proc telemetry; no GPU or Linux compositor required."""
import importlib.util
from pathlib import Path
import subprocess
import sys
import unittest
from unittest.mock import patch

path = Path(__file__).with_name('measure_linux.py')
spec = importlib.util.spec_from_file_location('s2_measure_linux', path)
if spec is None or spec.loader is None:
    raise RuntimeError('could not load measure_linux.py')
m = importlib.util.module_from_spec(spec)
spec.loader.exec_module(m)

class SamplerTests(unittest.TestCase):
    def test_recursive_tree_contains_current_python_process(self):
        pid = subprocess.Popen([sys.executable, '-c', 'import time;time.sleep(1)'])
        try:
            self.assertIn(pid.pid, m.process_tree(pid.pid))
        finally:
            pid.terminate()
            pid.wait(timeout=5)

    def test_current_cpu_time_and_pss_are_nonnegative(self):
        import os
        jiffies = m.cpu_jiffies(os.getpid())
        self.assertIsInstance(jiffies, int)
        self.assertGreaterEqual(jiffies, 0)
        pss = m.pss_kib(os.getpid())
        if pss is not None:
            self.assertGreater(pss, 0)

    def test_nvidia_failure_is_explicitly_missing_not_zero(self):
        with patch.object(m.subprocess, 'check_output', side_effect=FileNotFoundError()):
            self.assertIsNone(m.gpu_sample())

    def test_no_webkit_for_invalid_pid(self):
        self.assertEqual(m.webkit_processes({999999999}), [])

    def test_invalid_cli_does_not_write_results(self):
        with self.assertRaises(SystemExit):
            # argparse exits on invalid negative time through main() without touching /proc
            with patch.object(sys, 'argv', ['measure_linux.py','--pid','1','--phase','idle','--seconds','-10','--output','/tmp/s2-should-not-create.json']):
                m.main()

if __name__ == '__main__':
    unittest.main(verbosity=2)

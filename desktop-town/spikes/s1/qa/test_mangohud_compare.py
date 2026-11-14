"""Unit tests for qa/mangohud_compare.py (synthetic logs only).

Run: python3 -I -m unittest discover -s qa -p 'test_mangohud_compare.py'
"""
import sys
import tempfile
import unittest
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
import mangohud_compare as mc  # noqa: E402

PREAMBLE = "os,cpu,gpu,ram,kernel,driver,cpuscheduler\nCachyOS,Ryzen,RTX 3080,32GB,6.17,580.95,bore\n"


def log(frametimes, extra_cols=True):
    head = "fps,frametime,cpu_load,gpu_load,cpu_temp,gpu_temp,elapsed" if extra_cols else "frametime"
    rows = []
    for i, ft in enumerate(frametimes):
        rows.append(f"{1000 / ft:.1f},{ft},10,90,60,70,{i}" if extra_cols else f"{ft}")
    return PREAMBLE + head + "\n" + "\n".join(rows) + "\n"


class MangoHudCompareTest(unittest.TestCase):
    def write(self, text):
        f = tempfile.NamedTemporaryFile("w", suffix=".csv", delete=False)
        f.write(text)
        f.close()
        self.addCleanup(Path(f.name).unlink)
        return Path(f.name)

    def test_parses_preamble_and_ignores_garbage_rows(self):
        p = self.write(log([10.0] * 200) + "x,not-a-number,1\n,,\n")
        self.assertEqual(len(mc.read_frametimes(p)), 200)

    def test_summary_definitions(self):
        fts = [10.0] * 990 + [40.0] * 10  # 1 % of frames at 40 ms
        s = mc.summarize(fts)
        self.assertAlmostEqual(s["avg_fps"], 1000 / 10.3, places=6)  # 1000 frames in 10.3 s
        self.assertAlmostEqual(s["p99_ms"], 10.0)  # nearest-rank P99 is the 990th value
        fts2 = [10.0] * 980 + [40.0] * 20
        self.assertAlmostEqual(mc.summarize(fts2)["low1_fps"], 25.0)

    def test_compare_targets(self):
        base = mc.summarize([10.0] * 1000)  # 100 fps
        ok = mc.compare(base, mc.summarize([10.2] * 1000))  # ~1.96 % loss
        self.assertTrue(ok["avg_ok"] and ok["low1_ok"])
        bad = mc.compare(base, mc.summarize([10.5] * 1000))  # ~4.76 % avg loss
        self.assertFalse(bad["avg_ok"])
        self.assertTrue(bad["low1_ok"])

    def test_skip_seconds_drops_warmup(self):
        fts = [100.0] * 50 + [10.0] * 500  # 5 s of hitching then smooth
        p = self.write(log(fts, extra_cols=False))
        self.assertEqual(mc.read_frametimes(p, skip_seconds=5.0), [10.0] * 500)
        self.assertEqual(mc.read_frametimes(p, skip_seconds=1e9), [])

    def test_cli_exit_codes(self):
        base = self.write(log([10.0] * 1000))
        good = self.write(log([10.1] * 1000))
        slow = self.write(log([11.0] * 1000))
        short = self.write(log([10.0] * 10))
        notcsv = self.write("hello\nworld\n")
        self.assertEqual(mc.main([str(base), str(good), "--skip-seconds", "0"]), 0)
        self.assertEqual(mc.main([str(base), str(slow), "--skip-seconds", "0"]), 1)
        self.assertEqual(mc.main([str(base), str(short), "--skip-seconds", "0"]), 2)
        self.assertEqual(mc.main([str(base), str(notcsv)]), 2)


if __name__ == "__main__":
    unittest.main()

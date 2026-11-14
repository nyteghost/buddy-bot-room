#!/usr/bin/env python3
"""Compare two MangoHud CSV logs: game WITHOUT the S1 overlay vs WITH it.

Owner-run measurement aid (nothing here is a result by itself). Definitions:
  average FPS = frames / total frame time   (= 1000 / mean frametime_ms)
  1% low FPS  = 1000 / P99(frametime_ms)    (nearest-rank 99th percentile)
Project Phase-0 targets: average FPS loss <= 3 %, 1 % low loss <= 5 %.

  python3 mangohud_compare.py BASELINE.csv WITH_OVERLAY.csv [--skip-seconds 5]

Exit 0 = both within target, 1 = a target missed, 2 = unusable input.
Use the same game, scene/benchmark, settings, resolution and duration for
both runs; repeat each run 3x and compare medians before drawing conclusions.
"""
from __future__ import annotations

import argparse
import csv
import math
import sys
from pathlib import Path

AVG_TARGET_PCT = 3.0
LOW_TARGET_PCT = 5.0


def read_frametimes(path: Path, skip_seconds: float = 0.0) -> list[float]:
    """Frame times (ms) from a MangoHud CSV; tolerant of the metadata preamble."""
    rows = list(csv.reader(path.read_text(encoding="utf-8", errors="replace").splitlines()))
    header_idx = next((i for i, r in enumerate(rows) if "frametime" in [c.strip() for c in r]), None)
    if header_idx is None:
        raise ValueError(f"{path}: no 'frametime' column (is this a MangoHud CSV log?)")
    col = [c.strip() for c in rows[header_idx]].index("frametime")
    out: list[float] = []
    for r in rows[header_idx + 1:]:
        if len(r) <= col:
            continue
        try:
            v = float(r[col])
        except ValueError:
            continue
        if math.isfinite(v) and 0.0 < v < 10_000.0:
            out.append(v)
    # drop warm-up (loading hitch, shader compilation) by accumulated time
    if skip_seconds > 0:
        acc = 0.0
        for i, v in enumerate(out):
            acc += v
            if acc >= skip_seconds * 1000.0:
                out = out[i + 1:]
                break
        else:
            out = []
    return out


def percentile(values: list[float], p: float) -> float:
    s = sorted(values)
    rank = max(1, math.ceil(p / 100.0 * len(s)))
    return s[min(rank, len(s)) - 1]


def summarize(frametimes: list[float]) -> dict[str, float]:
    if len(frametimes) < 100:
        raise ValueError(f"need >= 100 frames, got {len(frametimes)}")
    total_ms = sum(frametimes)
    return {
        "frames": float(len(frametimes)),
        "seconds": total_ms / 1000.0,
        "avg_fps": len(frametimes) / (total_ms / 1000.0),
        "low1_fps": 1000.0 / percentile(frametimes, 99.0),
        "p99_ms": percentile(frametimes, 99.0),
    }


def loss_pct(baseline: float, test: float) -> float:
    return (baseline - test) / baseline * 100.0 if baseline > 0 else float("nan")


def compare(base: dict[str, float], test: dict[str, float]) -> dict[str, object]:
    avg = loss_pct(base["avg_fps"], test["avg_fps"])
    low = loss_pct(base["low1_fps"], test["low1_fps"])
    return {
        "avg_loss_pct": avg,
        "low1_loss_pct": low,
        "avg_ok": avg <= AVG_TARGET_PCT,
        "low1_ok": low <= LOW_TARGET_PCT,
    }


def main(argv: list[str]) -> int:
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("baseline", type=Path)
    ap.add_argument("with_overlay", type=Path)
    ap.add_argument("--skip-seconds", type=float, default=5.0)
    a = ap.parse_args(argv)
    try:
        base = summarize(read_frametimes(a.baseline, a.skip_seconds))
        test = summarize(read_frametimes(a.with_overlay, a.skip_seconds))
    except (OSError, ValueError) as exc:
        print(f"ERROR {exc}", file=sys.stderr)
        return 2
    c = compare(base, test)
    for name, s in (("baseline", base), ("with S1", test)):
        print(f"{name:9s} frames={s['frames']:.0f} seconds={s['seconds']:.1f} avg_fps={s['avg_fps']:.2f} "
              f"1%low_fps={s['low1_fps']:.2f} p99_ms={s['p99_ms']:.2f}")
    print(f"avg FPS loss {c['avg_loss_pct']:.2f} % (target <= {AVG_TARGET_PCT}) -> {'OK' if c['avg_ok'] else 'MISS'}")
    print(f"1% low loss  {c['low1_loss_pct']:.2f} % (target <= {LOW_TARGET_PCT}) -> {'OK' if c['low1_ok'] else 'MISS'}")
    print("Single-run comparison only: repeat 3x per condition and compare medians.")
    return 0 if c["avg_ok"] and c["low1_ok"] else 1


if __name__ == "__main__":
    sys.exit(main(sys.argv[1:]))

#!/usr/bin/env python3
"""Automated S1 acceptance run on a *headless wlroots (sway)* compositor.

What this proves: the S1 binary's layer-shell surface, transparent rendering,
dynamic GDK input region, click-through, lifecycle, multi-output placement,
fractional-scale hitbox alignment and hotplug fail-closed behaviour work on a
real Wayland compositor that implements zwlr_layer_shell_v1.

What this does NOT prove: KWin / Plasma 6 / NVIDIA behaviour. Those remain
owner-hardware gates (see qa/DEVICE-QA-CHECKLIST.md). Never report a pass
from this script as a KDE pass.

Usage (inside a disposable container/VM or a nested session, not your desktop):
  python3 qa/wlroots_acceptance.py --bin target/debug/pixel-pals-s1-kwin-overlay \
      --clicker qa/wlr-clicker/target/debug/s1-wlr-clicker --out qa/evidence/wlroots \
      --scale 1.0 [--second-output-scale 1.5] [--lifecycle 20]
Requires: sway, swaymsg; optional grim + python Pillow for pixel checks.
Exit status 0 only if every executed gate passed.
"""
from __future__ import annotations

import argparse
import json
import math
import os
import shutil
import signal
import subprocess
import sys
import tempfile
import time
from pathlib import Path

RADIUS = 24.0


class Proc:
    """A child process whose combined stdout/stderr is captured to a file."""

    def __init__(self, name: str, argv: list[str], env: dict, out_dir: Path, stdin=None):
        self.name = name
        self.log_path = out_dir / f"{name}.log"
        self.log = open(self.log_path, "w", encoding="utf-8")
        self.p = subprocess.Popen(argv, stdout=self.log, stderr=subprocess.STDOUT, env=env,
                                  stdin=stdin, text=True)

    def text(self) -> str:
        self.log.flush()
        return self.log_path.read_text(encoding="utf-8", errors="replace")

    def lines(self, prefix: str) -> list[str]:
        return [l for l in self.text().splitlines() if l.startswith(prefix)]

    def count(self, prefix: str) -> int:
        return len(self.lines(prefix))

    def wait_for(self, prefix: str, n: int = 1, timeout: float = 15.0) -> bool:
        end = time.monotonic() + timeout
        while time.monotonic() < end:
            if self.count(prefix) >= n:
                return True
            if self.p.poll() is not None:
                return self.count(prefix) >= n
            time.sleep(0.05)
        return False

    def stop(self, timeout: float = 5.0) -> int | None:
        if self.p.poll() is None:
            self.p.send_signal(signal.SIGTERM)
            try:
                self.p.wait(timeout)
            except subprocess.TimeoutExpired:
                self.p.kill()
                self.p.wait()
        self.log.flush()
        return self.p.returncode


class Session:
    def __init__(self, args):
        self.args = args
        self.out = Path(args.out).resolve()
        self.out.mkdir(parents=True, exist_ok=True)
        self.runtime = Path(tempfile.mkdtemp(prefix="s1-xdg-"))
        os.chmod(self.runtime, 0o700)
        self.env = dict(os.environ)
        self.env.update({
            "XDG_RUNTIME_DIR": str(self.runtime),
            "XDG_SESSION_TYPE": "wayland",
            "WLR_BACKENDS": "headless",
            "WLR_RENDERER": os.environ.get("WLR_RENDERER", "pixman"),
            "WLR_LIBINPUT_NO_DEVICES": "1",
            "WLR_HEADLESS_OUTPUTS": "1",
            "GDK_BACKEND": "wayland",
            "NO_AT_BRIDGE": "1",
        })
        for k in ("WAYLAND_DISPLAY", "DISPLAY", "SWAYSOCK"):
            self.env.pop(k, None)
        cfg = self.runtime / "sway.conf"
        cfg.write_text("default_border none\ndefault_floating_border none\n"
                       "focus_follows_mouse no\nxwayland disable\n")
        self.sway = Proc("sway", ["sway", "-c", str(cfg)], self.env, self.out)
        self.counter = 0
        self.results: list[dict] = []
        if not self._wait_socket():
            raise SystemExit(f"sway did not start; see {self.sway.log_path}")
        self.clicker: Proc | None = None

    def _wait_socket(self) -> bool:
        end = time.monotonic() + 20
        while time.monotonic() < end:
            socks = sorted(self.runtime.glob("wayland-*"))
            ipc = sorted(self.runtime.glob("sway-ipc.*.sock"))
            if socks and ipc and not str(socks[0]).endswith(".lock"):
                self.env["WAYLAND_DISPLAY"] = next(s.name for s in socks if not s.name.endswith(".lock"))
                self.env["SWAYSOCK"] = str(ipc[0])
                return True
            if self.sway.p.poll() is not None:
                return False
            time.sleep(0.1)
        return False

    def swaymsg(self, *cmd: str, json_out=False):
        argv = ["swaymsg"] + (["-r", "-t", cmd[0]] if json_out else [" ".join(cmd)])
        r = subprocess.run(argv, env=self.env, capture_output=True, text=True, timeout=10)
        if r.returncode != 0:
            raise RuntimeError(f"swaymsg {cmd}: {r.stdout} {r.stderr}")
        return json.loads(r.stdout) if json_out else r.stdout

    def outputs(self) -> list[dict]:
        return [o for o in self.swaymsg("get_outputs", json_out=True) if o.get("active")]

    def layout_extent(self) -> tuple[int, int]:
        outs = self.outputs()
        w = max(o["rect"]["x"] + o["rect"]["width"] for o in outs)
        h = max(o["rect"]["y"] + o["rect"]["height"] for o in outs)
        return w, h

    def spawn(self, name: str, *extra: str) -> Proc:
        self.counter += 1
        return Proc(f"{self.counter:02d}-{name}", [self.args.bin, *extra], self.env, self.out)

    # ---- clicker -------------------------------------------------------
    def start_clicker(self):
        self.clicker = Proc("clicker", [self.args.clicker], self.env, self.out, stdin=subprocess.PIPE)
        self.sent = 0

    def cmd(self, line: str):
        assert self.clicker is not None
        if self.clicker.p.poll() is not None:
            raise RuntimeError(f"clicker exited; see {self.clicker.log_path}")
        self.clicker.p.stdin.write(line + "\n")
        self.clicker.p.stdin.flush()
        self.sent += 1
        if not self.clicker.wait_for("CLICKER_", self.sent, timeout=10):
            raise RuntimeError(f"clicker stalled on {line!r}")
        if self.clicker.lines("CLICKER_")[-1].startswith("CLICKER_ERR"):
            raise RuntimeError(self.clicker.lines("CLICKER_")[-1])

    def refresh_extent(self):
        w, h = self.layout_extent()
        self.cmd(f"extent {w} {h}")

    def click(self, x: float, y: float, settle: float = 0.06):
        self.cmd(f"click {x:.0f} {y:.0f}")
        time.sleep(settle)

    def record(self, gate: str, status: str, detail: str, **data):
        entry = {"gate": gate, "status": status, "detail": detail, **data}
        self.results.append(entry)
        print(f"[{status}] {gate}: {detail}", flush=True)

    def screenshot(self, name: str, output: str) -> Path | None:
        """Physical-pixel capture of one output (includes layer surfaces)."""
        if not shutil.which("grim"):
            return None
        path = self.out / f"{name}.png"
        r = subprocess.run(["grim", "-o", output, str(path)], env=self.env, capture_output=True, text=True,
                           timeout=15)
        return path if r.returncode == 0 else None

    def close(self):
        if self.clicker:
            try:
                self.clicker.p.stdin.close()
            except Exception:
                pass
            self.clicker.stop()
        try:
            self.swaymsg("exit")
        except Exception:
            pass
        self.sway.stop()


def output_of_pid(tree: dict, pid: int, output: str | None = None) -> str | None:
    """Name of the sway output whose subtree holds a view with this pid."""
    if tree.get("type") == "output":
        output = tree.get("name")
    if tree.get("pid") == pid:
        return output
    for child in tree.get("nodes", []) + tree.get("floating_nodes", []):
        found = output_of_pid(child, pid, output)
        if found:
            return found
    return None


def place(s: "Session", proc: Proc, output: str) -> bool:
    """Deterministically move a client's window to `output` and verify it.

    `focus output` before spawning is racy for placement, so every QA window
    is moved by pid and checked against the compositor tree."""
    pid = proc.p.pid
    for _ in range(3):
        s.swaymsg(f"[pid={pid}] move container to output {output}")
        time.sleep(0.3)
        if output_of_pid(s.swaymsg("get_tree", json_out=True), pid) == output:
            return True
    return False


def pal_centres(overlay: Proc, outputs: dict[str, dict]) -> dict[str, tuple[float, float]]:
    """Latest Pal centre per connector in *layout* coordinates from S1_REGION."""
    centres = {}
    for line in overlay.lines("S1_REGION"):
        fields = dict(f.split("=", 1) for f in line.split()[1:] if "=" in f)
        if fields.get("bbox", "empty") == "empty":
            continue
        x, y, w, h = (int(v) for v in fields["bbox"].split(","))
        rect = outputs[fields["monitor"]]["rect"]
        centres[fields["monitor"]] = (rect["x"] + x + w / 2.0, rect["y"] + y + h / 2.0)
    return centres


def empty_points(rect: dict, centre: tuple[float, float], n: int) -> list[tuple[float, float]]:
    """n grid points inside `rect`, all at least RADIUS+16 px from the Pal."""
    pts = []
    cols = rows = math.ceil(math.sqrt(n))
    for r in range(rows):
        for c in range(cols):
            x = rect["x"] + (c + 0.5) * rect["width"] / cols
            y = rect["y"] + (r + 0.5) * rect["height"] / rows
            if math.dist((x, y), centre) < RADIUS + 16:
                x += RADIUS * 3  # shift clear of the Pal and its home marker
            pts.append((x, y))
    return pts[:n]


def counts(*procs: Proc) -> dict[str, int]:
    tally = {"underlay": 0, "pal": 0, "spurious": 0}
    for p in procs:
        tally["underlay"] += p.count("S1_UNDERLAY_CLICK")
        tally["pal"] += p.count("S1_PAL_CLICK")
        tally["spurious"] += p.count("S1_SPURIOUS_CLICK")
    return tally


def diff_outside_art(before: Path, during: Path, regions: list[tuple[int, int, int, int]]) -> tuple[int, int]:
    """Return (changed pixels outside allowed art boxes, changed pixels inside)."""
    from PIL import Image, ImageChops  # optional dependency

    a = Image.open(before).convert("RGB")
    b = Image.open(during).convert("RGB")
    if a.size != b.size:
        return (a.size[0] * a.size[1], 0)
    # "L" masks with explicit 0/255 values (mode "1" paste semantics are a trap).
    allowed = Image.new("L", a.size, 0)
    for (x, y, w, h) in regions:
        allowed.paste(255, (max(0, x), max(0, y), min(a.size[0], x + w), min(a.size[1], y + h)))
    changed = ImageChops.difference(a, b).convert("L").point(lambda v: 255 if v > 8 else 0)
    inside = ImageChops.multiply(changed, allowed)
    outside = ImageChops.multiply(changed, ImageChops.invert(allowed))
    return (outside.histogram()[255], inside.histogram()[255])


def run(args) -> int:
    s = Session(args)
    try:
        outs = s.outputs()
        primary = outs[0]["name"]
        s.swaymsg(f"output {primary} scale {args.scale} position 0 0")
        if args.second_output_scale:
            s.swaymsg("create_output")
            time.sleep(0.5)
            second = [o["name"] for o in s.outputs() if o["name"] != primary][0]
            width = next(o for o in s.outputs() if o["name"] == primary)["rect"]["width"]
            s.swaymsg(f"output {second} scale {args.second_output_scale} position {width} 0")
        time.sleep(0.5)
        outputs = {o["name"]: o for o in s.outputs()}
        s.record("env", "INFO", "compositor outputs",
                 outputs={k: {"rect": v["rect"], "scale": v.get("scale")} for k, v in outputs.items()})

        # One click-counting underlay per output (tiled → fills the output).
        underlays = []
        for name in outputs:
            s.swaymsg(f"focus output {name}")
            u = s.spawn(f"underlay-{name}", "--qa-underlay", "--seconds", "900")
            if not u.wait_for("S1_UNDERLAY_SIZE"):
                s.record("setup", "FAIL", f"underlay on {name} never allocated")
                return 1
            if not place(s, u, name):
                s.record("setup", "FAIL", f"underlay could not be placed on {name}")
                return 1
            underlays.append(u)
        time.sleep(0.3)
        tree = s.swaymsg("get_tree", json_out=True)
        s.record("setup", "INFO", "underlay placement verified from compositor tree",
                 placement={n: output_of_pid(tree, u.p.pid) for n, u in zip(outputs, underlays)})
        before = s.screenshot("transparency-0-before", primary)

        multi = len(outputs) > 1
        ov_args = ["--require-overlay", "--speed", "0", "--seconds", "900", "--trace-region", "--layer", "top"]
        ov_args += ["--all-monitors"] if multi else ["--monitor", primary]
        overlay = s.spawn("overlay-static", *ov_args)
        if not overlay.wait_for("S1_ALLOCATED", len(outputs)) or not overlay.wait_for("S1_REGION", len(outputs)):
            s.record("G0-overlay-ready", "FAIL", "overlay did not reach S1_ALLOCATED/S1_REGION on every output")
            return 1
        time.sleep(0.4)
        centres = pal_centres(overlay, outputs)
        s.record("G0-overlay-ready", "PASS" if len(centres) == len(outputs) else "FAIL",
                 f"layer surfaces mapped on {sorted(centres)}", centres=centres)
        during = s.screenshot("transparency-1-during", primary)
        s.start_clicker()
        s.refresh_extent()

        # Gate 1: pass-through outside the Pal.
        base = counts(overlay, *underlays)
        per_output = max(1, args.empty_clicks // len(outputs))
        for name, o in outputs.items():
            for (x, y) in empty_points(o["rect"], centres[name], per_output):
                s.click(x, y)
        time.sleep(0.4)
        c = counts(overlay, *underlays)
        total = per_output * len(outputs)
        ok = c["underlay"] - base["underlay"] == total and c["pal"] == base["pal"] and c["spurious"] == 0
        s.record("G1-pass-through", "PASS" if ok else "FAIL",
                 f"{c['underlay'] - base['underlay']}/{total} underlay clicks, pal={c['pal'] - base['pal']}, "
                 f"spurious={c['spurious']}")

        # Gate 2: clicks on the Pal (jittered inside radius-6).
        base = counts(overlay, *underlays)
        per_output_pal = max(1, args.pal_clicks // len(outputs))
        for name in outputs:
            cx, cy = centres[name]
            for i in range(per_output_pal):
                a = i * 2.39996
                rr = (RADIUS - 6) * math.sqrt((i % 10) / 10)
                s.click(cx + rr * math.cos(a), cy + rr * math.sin(a))
        time.sleep(0.4)
        c = counts(overlay, *underlays)
        total = per_output_pal * len(outputs)
        ok = c["pal"] - base["pal"] == total and c["underlay"] == base["underlay"] and c["spurious"] == 0
        s.record("G2-pal-hitbox", "PASS" if ok else "FAIL",
                 f"{c['pal'] - base['pal']}/{total} Pal clicks, underlay={c['underlay'] - base['underlay']}, "
                 f"spurious={c['spurious']}")

        # Gate 7 (scaling): hitbox edge precision, 8 directions per output.
        base = counts(overlay, *underlays)
        inside_ok = outside_ok = 0
        probes = 0
        for name in outputs:
            cx, cy = centres[name]
            for k in range(8):
                a = k * math.pi / 4
                b0 = counts(overlay, *underlays)
                s.click(cx + (RADIUS - 4) * math.cos(a), cy + (RADIUS - 4) * math.sin(a))
                time.sleep(0.05)
                inside_ok += counts(overlay, *underlays)["pal"] - b0["pal"]
                b1 = counts(overlay, *underlays)
                s.click(cx + (RADIUS + 4) * math.cos(a), cy + (RADIUS + 4) * math.sin(a))
                time.sleep(0.05)
                outside_ok += counts(overlay, *underlays)["underlay"] - b1["underlay"]
                probes += 1
        c = counts(overlay, *underlays)
        ok = inside_ok == probes and outside_ok == probes and c["spurious"] == 0
        s.record("G7-hitbox-edge-scale", "PASS" if ok else "FAIL",
                 f"inside r-4: {inside_ok}/{probes}, outside r+4: {outside_ok}/{probes}, "
                 f"scales={[o.get('scale') for o in outputs.values()]}")

        # Gate 4: transparency (pixel diff confined to Pal + home marker).
        if before and during:
            try:
                # Allowed art boxes (Pal disc + home marker) in the primary
                # output's physical pixels; everything else must be unchanged.
                o = outputs[primary]
                sc = float(o.get("scale") or 1.0)
                cx, cy = centres[primary]
                ox, oy = cx - o["rect"]["x"], cy - o["rect"]["y"]
                w, h = o["rect"]["width"], o["rect"]["height"]
                regions = [
                    (int((ox - RADIUS - 3) * sc), int((oy - RADIUS - 3) * sc),
                     int((2 * RADIUS + 6) * sc) + 1, int((2 * RADIUS + 6) * sc) + 1),
                    (int((w / 2 - 22) * sc), int((h / 2 + 38) * sc), int(44 * sc) + 1, int(20 * sc) + 1),
                ]
                outside, inside = diff_outside_art(before, during, regions)
                ok = outside == 0 and inside > 0
                s.record("G4-transparency", "PASS" if ok else "FAIL",
                         f"changed px outside art={outside}, inside art={inside}")
            except ImportError:
                s.record("G4-transparency", "UNVERIFIED", "python Pillow not installed")
        else:
            s.record("G4-transparency", "UNVERIFIED", "grim screenshot unavailable")

        # Gate 2b: moving hitbox (input region follows the Pal).
        overlay.stop()
        moving = s.spawn("overlay-moving", "--require-overlay", "--speed", "8", "--seconds", "900",
                         "--trace-region", "--monitor", primary)
        moving.wait_for("S1_REGION", 3)
        rect = outputs[primary]["rect"]
        start_centre = pal_centres(moving, outputs)[primary]
        hits = 0
        tries = 20
        for _ in range(tries):
            cx, cy = pal_centres(moving, outputs)[primary]
            b0 = counts(moving, *underlays)
            s.click(cx, cy, settle=0.1)
            hits += counts(moving, *underlays)["pal"] - b0["pal"]
        time.sleep(1.5)
        cx_now, _ = pal_centres(moving, outputs)[primary]
        stale_ok = None
        if abs(cx_now - start_centre[0]) > 3 * RADIUS:
            b0 = counts(moving, *underlays)
            s.click(*start_centre)
            stale_ok = counts(moving, *underlays)["underlay"] - b0["underlay"] == 1
        c = counts(moving, *underlays)
        ok = hits >= tries - 2 and c["spurious"] == 0 and stale_ok is not False
        s.record("G2b-moving-hitbox", "PASS" if ok else "FAIL",
                 f"tracked Pal hits {hits}/{tries} at 100 px/s; click at vacated start position reached "
                 f"underlay={stale_ok}; spurious={c['spurious']}")
        moving.stop()

        # Gate 3: lifecycle cycles; afterwards the old Pal spot must pass through.
        failures = []
        for n in range(1, args.lifecycle + 1):
            p = s.spawn(f"lifecycle-{n:02d}", "--require-overlay", "--seconds", "1", "--speed", "0",
                        "--monitor", primary)
            try:
                p.p.wait(15)
            except subprocess.TimeoutExpired:
                p.stop()
            t = p.text()
            if p.p.returncode != 0 or "S1_READY" not in t or "S1_TIMEOUT_EXIT" not in t or "CRITICAL" in t:
                failures.append(n)
        time.sleep(0.3)
        b0 = counts(*underlays)
        s.click(*centres[primary])
        residual_ok = counts(*underlays)["underlay"] - b0["underlay"] == 1
        after = s.screenshot("transparency-2-after", primary)
        after_ok = None
        if before and after:
            try:
                outside, _ = diff_outside_art(before, after, [])
                after_ok = outside == 0
            except ImportError:
                pass
        ok = not failures and residual_ok and after_ok is not False
        s.record("G3-lifecycle", "PASS" if ok else "FAIL",
                 f"{args.lifecycle - len(failures)}/{args.lifecycle} clean cycles (failed={failures}); "
                 f"no residual input region={residual_ok}; screen identical after exit={after_ok}")

        # Gate 5 (informational on sway): fullscreen window vs top/bottom layer.
        for layer in ("top", "bottom"):
            s.swaymsg(f"focus output {primary}")
            fs = s.spawn(f"underlay-fullscreen-{layer}", "--qa-underlay", "--qa-fullscreen", "--seconds", "900")
            fs.wait_for("S1_UNDERLAY_SIZE")
            place(s, fs, primary)
            time.sleep(0.4)
            ov = s.spawn(f"overlay-fullscreen-{layer}", "--require-overlay", "--speed", "0", "--seconds", "900",
                         "--monitor", primary, "--layer", layer)
            ov.wait_for("S1_ALLOCATED")
            time.sleep(0.4)
            b0 = counts(ov, fs)
            s.click(*centres[primary])
            time.sleep(0.2)
            c = counts(ov, fs)
            who = "pal" if c["pal"] > b0["pal"] else ("fullscreen-window" if c["underlay"] > b0["underlay"] else "none")
            s.screenshot(f"fullscreen-{layer}", primary)
            s.record(f"G5-fullscreen-{layer}", "INFO",
                     f"sway: click on Pal position while a fullscreen window is focused went to {who}; "
                     f"spurious={c['spurious']}", receiver=who)
            ov.stop()
            fs.stop()

        # Gate 6: hotplug fail-closed (multi-output only).
        if multi:
            hp = s.spawn("overlay-hotplug", "--require-overlay", "--speed", "0", "--seconds", "900",
                         "--all-monitors")
            hp.wait_for("S1_ALLOCATED", len(outputs))
            second = [n for n in outputs if n != primary][0]
            s.swaymsg(f"output {second} unplug")
            time.sleep(0.3)
            s.refresh_extent()
            try:
                hp.p.wait(5)
                exited = True
            except subprocess.TimeoutExpired:
                exited = False
                hp.stop()
            b0 = counts(*underlays)
            s.click(*centres[primary])
            residual_ok = counts(*underlays)["underlay"] - b0["underlay"] == 1
            ok = exited and hp.p.returncode == 0 and "S1_HOTPLUG_EXIT" in hp.text() and residual_ok
            s.record("G6-hotplug-fail-closed", "PASS" if ok else "FAIL",
                     f"process exited={exited} code={hp.p.returncode}; S1_HOTPLUG_EXIT logged="
                     f"{'S1_HOTPLUG_EXIT' in hp.text()}; primary output passes clicks afterwards={residual_ok}")

        for u in underlays:
            u.stop()
        return 0 if all(r["status"] in ("PASS", "INFO", "UNVERIFIED") for r in s.results) else 1
    except Exception as exc:  # report harness faults as failures, never passes
        s.record("harness", "FAIL", f"{type(exc).__name__}: {exc}")
        return 1
    finally:
        s.close()
        summary = {"scenario": args.label, "bin": args.bin, "results": s.results}
        (s.out / "summary.json").write_text(json.dumps(summary, indent=2))
        md = [f"## wlroots headless — {args.label}", "", "| Gate | Status | Detail |", "| --- | --- | --- |"]
        md += [f"| {r['gate']} | {r['status']} | {r['detail']} |" for r in s.results]
        (s.out / "summary.md").write_text("\n".join(md) + "\n")


def main() -> int:
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--bin", required=True)
    ap.add_argument("--clicker", required=True)
    ap.add_argument("--out", required=True)
    ap.add_argument("--label", default="default")
    ap.add_argument("--scale", type=float, default=1.0)
    ap.add_argument("--second-output-scale", type=float, default=None)
    ap.add_argument("--empty-clicks", type=int, default=100)
    ap.add_argument("--pal-clicks", type=int, default=30)
    ap.add_argument("--lifecycle", type=int, default=20)
    args = ap.parse_args()
    for exe in (args.bin, args.clicker):
        if not os.access(exe, os.X_OK):
            print(f"not executable: {exe}", file=sys.stderr)
            return 2
    for tool in ("sway", "swaymsg"):
        if not shutil.which(tool):
            print(f"missing required tool: {tool}", file=sys.stderr)
            return 2
    return run(args)


if __name__ == "__main__":
    sys.exit(main())

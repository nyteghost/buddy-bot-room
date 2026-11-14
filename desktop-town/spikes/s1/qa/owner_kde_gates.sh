#!/usr/bin/env bash
# Owner-run helper for the PHYSICAL CachyOS / KDE Plasma 6 / Wayland / NVIDIA
# gates. Run from a Konsole inside the Plasma Wayland session you are testing.
# It only starts/stops its own overlay processes and writes logs under
# ~/pixel-pals-s1-evidence/<timestamp>/. It installs nothing and changes no
# settings. NEVER run in CI (CI uses qa/wlroots_acceptance.py).
#
#   bash qa/owner_kde_gates.sh env          # Gate 0 environment report
#   bash qa/owner_kde_gates.sh smoke        # Gate 0 ready/allocated/exit
#   bash qa/owner_kde_gates.sh lifecycle    # Gate 3 20 cycles
#   bash qa/owner_kde_gates.sh failclosed   # SIGTERM, SIGKILL, X11 + strict fallback
#   bash qa/owner_kde_gates.sh idle         # 60 s idle Pal: CPU %, PSS, repaint count
#   bash qa/owner_kde_gates.sh power        # NVIDIA: 3×60 s no-overlay / idle / moving via nvidia-smi
#   bash qa/owner_kde_gates.sh run [ARGS]   # interactive overlay, logged (Gates 1,2,4–8)
#   bash qa/owner_kde_gates.sh summary      # counts from the logs of this session
#
# Binary: $S1_BIN, else installed /usr/bin/pixel-pals-s1-kwin-overlay, else
# target/debug/… in this checkout (build it first with `cargo build --locked`).
set -euo pipefail
here=$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)
if [[ -n ${S1_BIN:-} ]]; then bin=$S1_BIN
elif [[ -x /usr/bin/pixel-pals-s1-kwin-overlay ]]; then bin=/usr/bin/pixel-pals-s1-kwin-overlay
else bin=$here/../target/debug/pixel-pals-s1-kwin-overlay; fi
[[ -x $bin ]] || { echo "overlay binary not found: $bin" >&2; exit 2; }
root=${S1_EVIDENCE_DIR:-$HOME/pixel-pals-s1-evidence}
session=${S1_SESSION:-$(date +%Y%m%d)}
out=$root/$session
mkdir -p "$out"
stamp() { date +%H%M%S; }

require_wayland() {
  if [[ ${XDG_SESSION_TYPE:-} != wayland || -z ${WAYLAND_DISPLAY:-} ]]; then
    echo "Not a Wayland session (XDG_SESSION_TYPE=${XDG_SESSION_TYPE:-unset}). Log into 'Plasma (Wayland)'." >&2
    exit 2
  fi
}

case ${1:-help} in
  env)
    bash "$here/environment.sh" | tee "$out/env.log"
    { echo; echo "binary: $bin"; "$bin" --help | head -1; pacman -Q pixel-pals-s1-overlay-dev 2>/dev/null || true;
      git -C "$here/.." rev-parse HEAD 2>/dev/null || true; } | tee -a "$out/env.log"
    ;;
  smoke)
    require_wayland
    log=$out/g0-smoke-$(stamp).log
    set +e; "$bin" --require-overlay --seconds 5 --speed 0 --trace-region >"$log" 2>&1; code=$?; set -e
    cat "$log"
    for m in S1_READY S1_ALLOCATED S1_REGION S1_TIMEOUT_EXIT; do
      grep -q "$m" "$log" || { echo "G0 FAIL: missing $m (exit $code) — $log"; exit 1; }
    done
    [[ $code -eq 0 ]] && echo "G0 PASS (log: $log). Did you SEE the Pal and did it vanish after 5 s?"
    ;;
  lifecycle)
    require_wayland
    S1_BIN=$bin S1_EVIDENCE_DIR=$out/lifecycle bash "$here/lifecycle_20.sh" | tee "$out/g3-lifecycle.log"
    ;;
  failclosed)
    require_wayland
    log=$out/failclosed-$(stamp).log
    : >"$log"
    echo "== SIGTERM: overlay should vanish and log S1_SIGNAL_EXIT" | tee -a "$log"
    "$bin" --seconds 120 --speed 0 >>"$log" 2>&1 & pid=$!; sleep 3
    kill -TERM "$pid"; wait "$pid" && echo "exit 0" | tee -a "$log"
    grep -q S1_SIGNAL_EXIT "$log" && echo "SIGTERM PASS" | tee -a "$log" || echo "SIGTERM FAIL" | tee -a "$log"
    echo "== SIGKILL: KWin must destroy the surface; no Pal and no blocked clicks may remain" | tee -a "$log"
    "$bin" --seconds 120 --speed 0 >>"$log" 2>&1 & pid=$!; sleep 3
    kill -KILL "$pid"; wait "$pid" 2>/dev/null || true
    read -r -p "Is the Pal gone and can you click where it was? [y/n] " a; echo "SIGKILL human-check=$a" >>"$log"
    echo "== X11 GDK backend inside Wayland: strict must exit 2, default must open town-only window" | tee -a "$log"
    set +e
    GDK_BACKEND=x11 "$bin" --require-overlay --seconds 3 >>"$log" 2>&1; echo "strict-x11-exit=$?" | tee -a "$log"
    GDK_BACKEND=x11 "$bin" --seconds 5 >>"$log" 2>&1; echo "default-x11-exit=$?" | tee -a "$log"
    "$bin" --town-only --seconds 5 >>"$log" 2>&1; echo "town-only-exit=$?" | tee -a "$log"
    "$bin" --require-overlay --monitor NOPE-9 --seconds 3 >>"$log" 2>&1; echo "unknown-monitor-exit=$?" | tee -a "$log"
    set -e
    grep -c S1_TOWN_ONLY_READY "$log" | xargs echo "town-only windows shown (expect 2):" | tee -a "$log"
    echo "log: $log"
    ;;
  idle)
    require_wayland
    log=$out/idle-$(stamp).log
    echo "Leave the mouse alone for ~70 s. Logging to $log"
    "$bin" --require-overlay --speed 0 --stats 10 --seconds 65 2>&1 | tee "$log"
    echo "--- idle windows after the first (expect frames=0 region_updates=0; target cpu_pct <= 2.00):"
    grep S1_STATS "$log" | tail -n +2 | awk '{print $4, $9, $10, $11}'
    ;;
  power)
    require_wayland
    command -v nvidia-smi >/dev/null || { echo "nvidia-smi not found (NVIDIA driver utilities)"; exit 2; }
    csv=$out/power-$(stamp).csv
    log=$out/power-$(stamp).log
    echo "Close games/videos; leave the desktop idle for ~3.5 minutes. CSV: $csv"
    nvidia-smi --query-gpu=timestamp,power.draw,utilization.gpu,clocks.gr,memory.used,pstate \
      --format=csv,noheader,nounits -l 1 >"$csv" & smi=$!
    trap 'kill "$smi" 2>/dev/null || true' EXIT
    mark() { echo "PHASE $1 $(date +%s)" | tee -a "$log"; }
    mark baseline-no-overlay; sleep 60
    mark idle-pal; "$bin" --require-overlay --speed 0 --stats 20 --seconds 60 >>"$log" 2>&1
    mark moving-pal; "$bin" --require-overlay --speed 4 --stats 20 --seconds 60 >>"$log" 2>&1
    mark end; sleep 2; kill "$smi" 2>/dev/null || true
    python3 - "$csv" "$log" <<'PY'
import sys, datetime
csv, log = sys.argv[1], sys.argv[2]
marks = [(l.split()[1], int(l.split()[2])) for l in open(log) if l.startswith("PHASE ")]
rows = []
for line in open(csv):
    p = [x.strip() for x in line.split(",")]
    try:
        t = datetime.datetime.strptime(p[0], "%Y/%m/%d %H:%M:%S.%f").timestamp()
        rows.append((t, float(p[1]), float(p[2]), float(p[3]), float(p[4]), p[5]))
    except (ValueError, IndexError):
        pass
for (name, start), (_, end) in zip(marks, marks[1:]):
    sel = [r for r in rows if start + 3 <= r[0] < end]  # skip 3 s settle
    if not sel:
        print(f"{name}: no samples"); continue
    avg = lambda i: sum(r[i] for r in sel) / len(sel)
    print(f"{name:20s} n={len(sel):3d} power_W={avg(1):6.1f} util%={avg(2):5.1f} "
          f"clock_MHz={avg(3):6.0f} mem_MiB={avg(4):6.0f} pstates={sorted({r[5] for r in sel})}")
PY
    echo "Compare idle-pal / moving-pal against baseline-no-overlay. Single run: repeat 3x."
    ;;
  run)
    require_wayland
    shift
    log=$out/run-$(stamp).log
    echo "Logging to $log — stop with Ctrl+C here or: pkill -TERM -f pixel-pals-s1-kwin-overlay"
    "$bin" --trace-region "$@" 2>&1 | tee "$log"
    ;;
  summary)
    for f in "$out"/run-*.log; do
      [[ -f $f ]] || continue
      printf '%s: pal=%s spurious=%s hotplug=%s scale_changed=%s ready=%s\n' "$(basename "$f")" \
        "$(grep -c S1_PAL_CLICK "$f")" "$(grep -c S1_SPURIOUS_CLICK "$f")" \
        "$(grep -c S1_HOTPLUG_EXIT "$f")" "$(grep -c S1_SCALE_CHANGED "$f")" "$(grep -c S1_READY "$f")"
    done
    echo "evidence folder: $out"
    ;;
  *)
    sed -n '2,18p' "$0"
    ;;
esac

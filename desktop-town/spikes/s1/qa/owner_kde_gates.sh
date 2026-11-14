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
    sed -n '2,16p' "$0"
    ;;
esac

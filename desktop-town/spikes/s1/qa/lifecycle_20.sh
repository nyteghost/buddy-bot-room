#!/usr/bin/env bash
# Must run in a real Wayland/KWin desktop terminal. NEVER runs in CI/headless.
set -euo pipefail
cd "$(dirname "${BASH_SOURCE[0]}")/.."
mkdir -p qa/evidence
cargo build --locked
bin=target/debug/pixel-pals-s1-kwin-overlay
for n in $(seq 1 20); do
  log="qa/evidence/lifecycle-$(printf '%02d' "$n").log"
  echo "Cycle $n/20 — expect S1_READY and S1_TIMEOUT_EXIT"
  if ! "$bin" --require-overlay --seconds 2 --speed 0 >"$log" 2>&1; then
    echo "FAILED cycle $n (non-zero exit): $log"; exit 1
  fi
  if ! grep -q 'S1_READY' "$log" || ! grep -q 'S1_TIMEOUT_EXIT' "$log"; then
    echo "FAILED cycle $n (missing ready/close log): $log"; exit 1
  fi
  if grep -Eq 'S1_SPURIOUS_CLICK|Gtk-WARNING|Gdk-CRITICAL|GLib-CRITICAL' "$log"; then
    echo "FAILED cycle $n (runtime warning): $log"; exit 1
  fi
  sleep 0.2
done
echo '20/20 process lifecycle cycles succeeded. Human must still check for lingering surfaces and compositor health.'

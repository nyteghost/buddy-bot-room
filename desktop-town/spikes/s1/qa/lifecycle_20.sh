#!/usr/bin/env bash
# Gate 3: 20 create/map/destroy cycles. Run in a real KDE Wayland terminal.
# NEVER runs in CI/headless (CI uses qa/wlroots_acceptance.py instead).
#   Source checkout:   bash qa/lifecycle_20.sh
#   Installed package: S1_BIN=/usr/bin/pixel-pals-s1-kwin-overlay \
#                      bash /usr/share/pixel-pals-s1/qa/lifecycle_20.sh
set -euo pipefail
cycles=${S1_CYCLES:-20}
if [[ -n ${S1_BIN:-} ]]; then
  bin=$S1_BIN
  evidence=${S1_EVIDENCE_DIR:-$HOME/pixel-pals-s1-evidence}
else
  cd "$(dirname "${BASH_SOURCE[0]}")/.."
  cargo build --locked
  bin=target/debug/pixel-pals-s1-kwin-overlay
  evidence=${S1_EVIDENCE_DIR:-qa/evidence}
fi
mkdir -p "$evidence"
for n in $(seq 1 "$cycles"); do
  log="$evidence/lifecycle-$(printf '%02d' "$n").log"
  echo "Cycle $n/$cycles — expect S1_READY, S1_ALLOCATED and S1_TIMEOUT_EXIT"
  if ! "$bin" --require-overlay --seconds 2 --speed 0 >"$log" 2>&1; then
    echo "FAILED cycle $n (non-zero exit): $log"; exit 1
  fi
  for marker in S1_READY S1_ALLOCATED S1_TIMEOUT_EXIT; do
    grep -q "$marker" "$log" || { echo "FAILED cycle $n (missing $marker): $log"; exit 1; }
  done
  if grep -Eq 'S1_SPURIOUS_CLICK|Gtk-WARNING|Gtk-CRITICAL|Gdk-CRITICAL|GLib-CRITICAL|panicked' "$log"; then
    echo "FAILED cycle $n (runtime warning): $log"; exit 1
  fi
  sleep 0.3
done
echo "$cycles/$cycles process lifecycle cycles succeeded (logs: $evidence)."
echo 'A human must still confirm: no lingering Pal, desktop clicks work, compositor healthy.'

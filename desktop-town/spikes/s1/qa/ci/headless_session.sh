#!/usr/bin/env bash
# Run a command inside a throwaway *headless* Wayland compositor.
#   headless_session.sh sway   -- CMD...   wlroots: has zwlr_layer_shell_v1
#   headless_session.sh weston -- CMD...   no wlr-layer-shell → S1 must fall back
# CI / disposable containers only. Never point this at your real desktop.
set -euo pipefail
kind=${1:?sway|weston}; shift
[[ ${1:-} == "--" ]] && shift
runtime=$(mktemp -d /tmp/s1-xdg-XXXXXX)
chmod 700 "$runtime"
export XDG_RUNTIME_DIR=$runtime XDG_SESSION_TYPE=wayland GDK_BACKEND=wayland NO_AT_BRIDGE=1
unset WAYLAND_DISPLAY DISPLAY SWAYSOCK
log=$runtime/compositor.log
case $kind in
  sway)
    printf 'xwayland disable\ndefault_border none\n' >"$runtime/sway.conf"
    WLR_BACKENDS=headless WLR_RENDERER=${WLR_RENDERER:-pixman} WLR_LIBINPUT_NO_DEVICES=1 \
      sway -c "$runtime/sway.conf" >"$log" 2>&1 &
    ;;
  weston)
    weston --backend=headless --socket=wayland-s1 --idle-time=0 >"$log" 2>&1 &
    ;;
  *) echo "unknown compositor $kind" >&2; exit 2 ;;
esac
pid=$!
trap 'kill "$pid" 2>/dev/null || true; wait "$pid" 2>/dev/null || true; rm -rf "$runtime"' EXIT
for _ in $(seq 1 100); do
  sock=$(find "$runtime" -maxdepth 1 -name 'wayland-*' ! -name '*.lock' -printf '%f\n' | head -n1)
  [[ -n $sock ]] && break
  kill -0 "$pid" 2>/dev/null || { cat "$log"; exit 1; }
  sleep 0.1
done
[[ -n ${sock:-} ]] || { echo "compositor socket never appeared" >&2; cat "$log"; exit 1; }
export WAYLAND_DISPLAY=$sock
echo "headless $kind ready on $WAYLAND_DISPLAY" >&2
"$@"
